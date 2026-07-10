// Files plugin: read/write/list, each confined to the caller's accessible repos via ctx.assertPathAllowed
// (which reads the per-session Policy). A guard rejection is returned as an error text so the model can
// react, not thrown, matching how the elowen_* tools surface API errors.
import { defineTool, withFileMutationQueue, truncateHead, truncateLine, formatSize, generateDiffString, generateUnifiedPatch, resizeImage, formatDimensionNote } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

const DEFAULT_MAX = 100_000;
const DEFAULT_SEARCH_MAX_MATCHES = 200;
const SEARCH_TIMEOUT_MS = 5_000;
const DIFF_CONTEXT = 3;
const DIFF_MAX_LINES = 200;
const RESULT_LINE_MAX = 500; // cap each search hit so one minified line can't flood the result set
// Raw-byte cap for embedding an image we couldn't resize. base64 inflates ~4/3, and the API rejects images
// whose encoded payload tops ~5 MB, so cap the RAW bytes at ~3.75 MB to keep the base64 under that ceiling.
const IMAGE_MAX_BYTES = 3_750_000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'web-dist', '.next', '.turbo']);
const execFileP = promisify(execFile);
const ok = (tool, text, details = {}) => ({
  content: [{ type: 'text', text }],
  details: { ok: true, tool, truncated: false, ...details },
});
const fail = (tool, e, details = {}) => ok(tool, `Error: ${e instanceof Error ? e.message : String(e)}`, {
  ok: false,
  error: { message: e instanceof Error ? e.message : String(e) },
  ...details,
});

/** Slice `text` to at most `maxBytes` UTF-8 bytes without splitting a multi-byte character. */
function sliceBytes(text, maxBytes) {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1; // back up to a UTF-8 char boundary
  return buf.subarray(0, end).toString('utf-8');
}

// ── Fuzzy-edit core ──────────────────────────────────────────────────────────
// PI's edit tool tolerates smart quotes / Unicode dashes / trailing whitespace and preserves BOM+CRLF,
// but the package's exports map (only "." and "./rpc-entry") blocks importing edit-diff's fuzzyFindText /
// applyEditsToNormalizedContent / stripBom / line-ending helpers. These are a faithful port of that logic
// (node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit-diff.js) so our own defineTool wrapper
// keeps the ctx.assertPathAllowed guard and details shape while gaining the same matching semantics.

function detectLineEnding(content) {
  const crlf = content.indexOf('\r\n');
  const lf = content.indexOf('\n');
  if (lf === -1 || crlf === -1) return '\n';
  return crlf < lf ? '\r\n' : '\n';
}
function normalizeToLF(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
function restoreLineEndings(text, ending) {
  return ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}
/** Strip trailing per-line whitespace and fold smart quotes / Unicode dashes / exotic spaces to ASCII. */
function normalizeForFuzzyMatch(text) {
  return text
    .normalize('NFKC')
    .split('\n').map((line) => line.trimEnd()).join('\n')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[  -   　]/g, ' ');
}
/** Strip a leading UTF-8 BOM, returning it separately so it can be restored on write. */
function stripBom(content) {
  return content.startsWith('﻿') ? { bom: '﻿', text: content.slice(1) } : { bom: '', text: content };
}
function splitLinesWithEndings(content) {
  return content.match(/[^\n]*\n|[^\n]+/g) ?? [];
}
function getLineSpans(content) {
  let offset = 0;
  return splitLinesWithEndings(content).map((line) => {
    const span = { start: offset, end: offset + line.length };
    offset = span.end;
    return span;
  });
}
function getReplacementLineRange(lines, replacement) {
  const start = replacement.matchIndex;
  const end = replacement.matchIndex + replacement.matchLength;
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start >= lines[i].start && start < lines[i].end) { startLine = i; break; }
  }
  if (startLine === -1) throw new Error('Replacement range is outside the base content.');
  let endLine = startLine;
  while (endLine < lines.length && lines[endLine].end < end) endLine++;
  if (endLine >= lines.length) throw new Error('Replacement range is outside the base content.');
  return { startLine, endLine: endLine + 1 };
}
/** Apply replacements (ascending, non-overlapping) to `content` in reverse so earlier offsets stay valid. */
function applyReplacements(content, replacements, offset = 0) {
  let result = content;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    const at = r.matchIndex - offset;
    result = result.substring(0, at) + r.newText + result.substring(at + r.matchLength);
  }
  return result;
}
/** Overlay fuzzy-space replacements onto the original content, rewriting only the touched line blocks so
 *  every other line keeps its exact original bytes (base and original must share a line count). */
function applyReplacementsPreservingUnchangedLines(originalContent, baseContent, replacements) {
  const originalLines = splitLinesWithEndings(originalContent);
  const baseLines = getLineSpans(baseContent);
  if (originalLines.length !== baseLines.length) {
    throw new Error('Cannot preserve unchanged lines because the base content has a different line count.');
  }
  const groups = [];
  for (const replacement of [...replacements].sort((a, b) => a.matchIndex - b.matchIndex)) {
    const range = getReplacementLineRange(baseLines, replacement);
    const current = groups[groups.length - 1];
    if (current && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine);
      current.replacements.push(replacement);
      continue;
    }
    groups.push({ ...range, replacements: [replacement] });
  }
  let originalLineIndex = 0;
  let result = '';
  for (const group of groups) {
    result += originalLines.slice(originalLineIndex, group.startLine).join('');
    const groupStart = baseLines[group.startLine].start;
    const groupEnd = baseLines[group.endLine - 1].end;
    result += applyReplacements(baseContent.slice(groupStart, groupEnd), group.replacements, groupStart);
    originalLineIndex = group.endLine;
  }
  result += originalLines.slice(originalLineIndex).join('');
  return result;
}
function findAllOccurrences(haystack, needle) {
  const out = [];
  let i = haystack.indexOf(needle);
  while (i !== -1) { out.push(i); i = haystack.indexOf(needle, i + needle.length); }
  return out;
}
/** Plan a fuzzy-tolerant edit: exact match first, then a normalized-space match; preserve BOM/CRLF. Returns
 *  { content, newContent, after, count } (both LF, no BOM, for diffing) or { error } for the caller to surface. */
function planEdit(rawBefore, oldTextRaw, newTextRaw, replaceAll) {
  const { bom, text } = stripBom(rawBefore);
  const ending = detectLineEnding(text);
  const content = normalizeToLF(text);
  const oldLF = normalizeToLF(oldTextRaw);
  const newLF = normalizeToLF(newTextRaw);
  if (oldLF.length === 0) return { error: 'empty' };
  let base = content;
  let needle = oldLF;
  let fuzzy = false;
  let idxs = findAllOccurrences(content, oldLF);
  if (idxs.length === 0) {
    base = normalizeForFuzzyMatch(content);
    needle = normalizeForFuzzyMatch(oldLF);
    fuzzy = true;
    idxs = needle.length === 0 ? [] : findAllOccurrences(base, needle);
  }
  if (idxs.length === 0) return { error: 'notfound' };
  if (idxs.length > 1 && !replaceAll) return { error: 'ambiguous', count: idxs.length };
  const targets = replaceAll ? idxs : [idxs[0]];
  const replacements = targets.map((matchIndex) => ({ matchIndex, matchLength: needle.length, newText: newLF }));
  const newContent = fuzzy
    ? applyReplacementsPreservingUnchangedLines(content, base, replacements)
    : applyReplacements(content, replacements);
  return { content, newContent, after: bom + restoreLineEndings(newContent, ending), count: targets.length };
}

/** PI's line-numbered display diff, capped so a huge edit can't flood the transcript. The CLI (renderDiff)
 *  and web (DiffBlock) renderers both accept this `±<n> text` / ` <n> text` row format. */
function displayDiff(before, after) {
  const { diff } = generateDiffString(before, after, DIFF_CONTEXT);
  if (!diff) return '';
  const lines = diff.split('\n');
  if (lines.length <= DIFF_MAX_LINES) return diff;
  return [...lines.slice(0, DIFF_MAX_LINES), `…[diff truncated: ${lines.length - DIFF_MAX_LINES} more lines]`].join('\n');
}
/** Applicable unified patch for review/tooling; omitted when large enough that it would bloat the event. */
function unifiedPatch(path, before, after) {
  const patch = generateUnifiedPatch(path, before, after, DIFF_CONTEXT);
  if (!patch || after === before) return undefined;
  return patch.split('\n').length > DIFF_MAX_LINES * 4 ? undefined : patch;
}

// Magic-byte image sniff — a faithful port of PI's detectSupportedImageMimeType
// (node_modules/@earendil-works/pi-coding-agent/dist/utils/mime.js). The full-header validation is NOT
// optional cosmetics: "BM", "GIF" and "\x89PNG" are common enough as plain-text/binary prefixes that a
// prefix-only sniff would misclassify a real text file as an image, drop into the image branch, fail to
// resize, and return an "[Image omitted]" stub instead of the file's actual text — silent data loss on a
// normal read. So BMP validates its 26-byte header, PNG its 8-byte signature + IHDR + non-animated, and
// JPEG rejects the unsupported JPEG-LS (0xf7) variant, exactly as PI does.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function startsWithBytes(buf, bytes) {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}
function startsWithAscii(buf, offset, text) {
  if (buf.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) if (buf[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}
function readUint16LE(buf, o) { return (buf[o] ?? 0) + ((buf[o + 1] ?? 0) << 8); }
function readUint32BE(buf, o) {
  return (buf[o] ?? 0) * 0x1000000 + ((buf[o + 1] ?? 0) << 16) + ((buf[o + 2] ?? 0) << 8) + (buf[o + 3] ?? 0);
}
function readUint32LE(buf, o) {
  return (buf[o] ?? 0) + ((buf[o + 1] ?? 0) << 8) + ((buf[o + 2] ?? 0) << 16) + (buf[o + 3] ?? 0) * 0x1000000;
}
function isPng(buf) {
  return buf.length >= 16 && readUint32BE(buf, PNG_SIGNATURE.length) === 13 && startsWithAscii(buf, 12, 'IHDR');
}
function isAnimatedPng(buf) {
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= buf.length) {
    const chunkLength = readUint32BE(buf, offset);
    const chunkTypeOffset = offset + 4;
    if (startsWithAscii(buf, chunkTypeOffset, 'acTL')) return true;
    if (startsWithAscii(buf, chunkTypeOffset, 'IDAT')) return false;
    const next = offset + 8 + chunkLength + 4;
    if (next <= offset || next > buf.length) return false;
    offset = next;
  }
  return false;
}
function isBmp(buf) {
  if (buf.length < 26) return false;
  const declaredFileSize = readUint32LE(buf, 2);
  const pixelDataOffset = readUint32LE(buf, 10);
  const dibHeaderSize = readUint32LE(buf, 14);
  if (declaredFileSize !== 0 && declaredFileSize < 26) return false;
  if (pixelDataOffset < 14 + dibHeaderSize) return false;
  if (declaredFileSize !== 0 && pixelDataOffset >= declaredFileSize) return false;
  let colorPlanes;
  let bitsPerPixel;
  if (dibHeaderSize === 12) {
    colorPlanes = readUint16LE(buf, 22);
    bitsPerPixel = readUint16LE(buf, 24);
  } else if (dibHeaderSize >= 40 && dibHeaderSize <= 124) {
    if (buf.length < 30) return false;
    colorPlanes = readUint16LE(buf, 26);
    bitsPerPixel = readUint16LE(buf, 28);
  } else {
    return false;
  }
  return colorPlanes === 1 && [1, 4, 8, 16, 24, 32].includes(bitsPerPixel);
}
function detectImageMime(buf) {
  if (startsWithBytes(buf, [0xff, 0xd8, 0xff])) return buf[3] === 0xf7 ? null : 'image/jpeg';
  if (startsWithBytes(buf, PNG_SIGNATURE)) return isPng(buf) && !isAnimatedPng(buf) ? 'image/png' : null;
  // Require the full 6-byte GIF signature incl. version (PI sniffs only "GIF") — the 3-byte prefix alone
  // misfires on ordinary text ("GIFT ideas…"), which would then be embedded as a broken image/gif block.
  if (startsWithAscii(buf, 0, 'GIF87a') || startsWithAscii(buf, 0, 'GIF89a')) return 'image/gif';
  if (startsWithAscii(buf, 0, 'RIFF') && startsWithAscii(buf, 8, 'WEBP')) return 'image/webp';
  if (startsWithAscii(buf, 0, 'BM') && isBmp(buf)) return 'image/bmp';
  return null;
}
const INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function safeRegex(query) {
  try { return new RegExp(query, 'i'); }
  catch { return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
}

function safeRegexSource(query) {
  try { new RegExp(query); return query; }
  catch { return String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
}

function globRegex(glob) {
  if (!glob) return null;
  const source = String(glob);
  let escaped = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '*') {
      if (source[i + 1] === '*') { escaped += '.*'; i += 1; }
      else escaped += '[^/]*';
    } else if (ch === '{') {
      const close = source.indexOf('}', i + 1);
      if (close > i + 1) {
        const variants = source.slice(i + 1, close).split(',').filter(Boolean);
        escaped += `(?:${variants.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
        i = close;
      } else {
        escaped += '\\{';
      }
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      escaped += `\\${ch}`;
    } else {
      escaped += ch;
    }
  }
  return new RegExp(`^${escaped}$`);
}

function walkFiles(root, limit = 5000) {
  const s = statSync(root);
  if (s.isFile()) return [root];
  const out = [];
  const walk = (dir) => {
    if (out.length >= limit) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= limit) break;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(join(dir, ent.name));
      } else if (ent.isFile()) {
        out.push(join(dir, ent.name));
      }
    }
  };
  walk(root);
  return out;
}

async function rgSearch(abs, root, queryText, include, mode, maxMatches) {
  const ignoreGlobs = [...SKIP_DIRS].map((d) => `!${d}/**`);
  if (mode === 'files') {
    const args = ['--files', ...ignoreGlobs.flatMap((g) => ['--glob', g]), ...(include ? ['--glob', include] : []), abs];
    try {
      const { stdout } = await execFileP('rg', args, { cwd: root, encoding: 'utf8', timeout: SEARCH_TIMEOUT_MS, maxBuffer: 1_000_000 });
      const query = safeRegex(queryText);
      return stdout.split('\n').filter(Boolean)
        .map((p) => relative(root, p.startsWith('/') ? p : join(root, p)) || p)
        .filter((p) => query.test(p))
        .slice(0, maxMatches);
    } catch (e) {
      // rg exits 1 on "no files matched" just like content mode — that's a real empty result, NOT an
      // rg-unavailable signal. Without this the caller would treat it as a miss and fall back to the JS
      // walk (which ignores .gitignore), surfacing gitignored files rg deliberately skipped.
      if (e && typeof e === 'object' && 'code' in e && e.code === 1) return [];
      throw e;
    }
  }
  const args = [
    '--line-number', '--with-filename', '--color', 'never', '--no-heading', '-i',
    ...ignoreGlobs.flatMap((g) => ['--glob', g]),
    ...(include ? ['--glob', include] : []),
    '--',
    safeRegexSource(queryText),
    abs,
  ];
  try {
    const { stdout } = await execFileP('rg', args, { cwd: root, encoding: 'utf8', timeout: SEARCH_TIMEOUT_MS, maxBuffer: 1_000_000 });
    return stdout.split('\n').filter(Boolean).map((line) => {
      if (!line.startsWith('/')) return line;
      const first = line.indexOf(':');
      const second = first >= 0 ? line.indexOf(':', first + 1) : -1;
      if (second < 0) return line;
      return `${relative(root, line.slice(0, first))}${line.slice(first)}`;
    }).slice(0, maxMatches);
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 1) return [];
    throw e;
  }
}

export function register(ctx) {
  const readCap = Math.min(Math.max(Number(ctx.config.readCap) || DEFAULT_MAX, 20_000), 500_000);
  const searchMaxMatches = Math.min(Math.max(Number(ctx.config.searchMaxMatches) || DEFAULT_SEARCH_MAX_MATCHES, 50), 1000);

  ctx.registerTool(defineTool({
    name: 'read_file', label: 'Read file',
    description: [
      'Read a UTF-8 text file or an image within the accessible repositories.',
      'Use when you need exact source text, config, logs, or docs before editing.',
      'Do not use for broad discovery; use search_files or list_dir first.',
      'Input requires an absolute path. For large files use offset/limit (1-indexed lines) and follow the continuation hint.',
      'Images (jpg/png/gif/webp/bmp) are returned as an attachment. Output may be truncated; details.truncated tells you if more targeted reads are needed.',
    ].join(' '),
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute path to the file' }),
      offset: Type.Optional(Type.Number({ description: 'Line number to start reading from (1-indexed)' })),
      limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to read' })),
    }),
    execute: async (_id, p, _signal, _onUpdate, ectx) => {
      try {
        const abs = ctx.assertPathAllowed(p.path);
        const raw = readFileSync(abs);
        const mime = detectImageMime(raw);
        if (mime) {
          const model = ectx?.model ?? ctx.model;
          const supportsImages = !model || (Array.isArray(model.input) ? model.input.includes('image') : true);
          const details = { ok: true, tool: 'read_file', truncated: false, path: abs, bytes: raw.length, image: true, mimeType: mime };
          const resized = await resizeImage(raw, mime, { maxWidth: 2000, maxHeight: 2000 }).catch(() => null);
          let data = resized?.data;
          let outMime = resized?.mimeType ?? mime;
          const hints = [];
          if (resized) {
            const dim = formatDimensionNote(resized);
            if (dim) hints.push(dim);
          } else if (INLINE_IMAGE_TYPES.has(mime) && raw.length <= IMAGE_MAX_BYTES) {
            data = raw.toString('base64'); // Photon unavailable: embed the original bytes for supported formats
            outMime = mime;
          }
          // The API accepts only jpeg/png/gif/webp image blocks. resizeImage can hand back a small BMP
          // unconverted (raw bytes, mimeType still image/bmp); embedding that would 400 the whole turn, so
          // drop any image whose final type isn't inline-supported and fall through to the text-only note.
          if (data && !INLINE_IMAGE_TYPES.has(outMime)) data = undefined;
          details.mimeType = outMime;
          let note = `Read image file [${outMime}]`;
          if (hints.length) note += `\n${hints.join('\n')}`;
          if (!data) {
            note += `\n[Image omitted: could not be resized or embedded inline.]`;
            return { content: [{ type: 'text', text: note }], details };
          }
          if (!supportsImages) {
            note += `\n[Current model does not support images. The image will be omitted from this request.]`;
            return { content: [{ type: 'text', text: note }], details };
          }
          return { content: [{ type: 'text', text: note }, { type: 'image', data, mimeType: outMime }], details };
        }
        const body = raw.toString('utf-8');
        const allLines = body.split('\n');
        // A trailing newline yields a phantom empty final element — it terminates the last line, it is not a
        // line of its own. Drop it from the count so pagination doesn't advertise (and truncate at) a bogus
        // extra empty line, which would report `truncated: true` and hand out a continuation offset that
        // reads back nothing.
        const total = allLines.length - (body.endsWith('\n') && allLines.length > 1 ? 1 : 0);
        const start = p.offset ? Math.max(0, Math.floor(p.offset) - 1) : 0;
        if (start >= total) return fail('read_file', new Error(`Offset ${p.offset} is beyond end of file (${total} lines total)`), { path: abs });
        const endLine = p.limit !== undefined ? Math.min(start + Math.max(0, Math.floor(p.limit)), total) : total;
        const selected = allLines.slice(start, endLine).join('\n');
        const r = truncateHead(selected, { maxBytes: readCap, maxLines: Infinity });
        let shownText;
        let shownLines;
        let byteTruncated;
        if (r.firstLineExceedsLimit) {
          shownText = sliceBytes(selected, readCap);
          shownLines = 1;
          byteTruncated = true;
        } else {
          shownText = r.content;
          byteTruncated = r.truncated;
          shownLines = r.truncated ? r.outputLines : (endLine - start);
        }
        const endShown = start + shownLines; // 1-indexed last line shown
        const truncated = byteTruncated || endShown < total;
        let text = shownText;
        if (r.firstLineExceedsLimit) {
          text += `\n\n[Line ${start + 1} exceeds the ${formatSize(readCap)} read limit; showing the first ${formatSize(Buffer.byteLength(shownText))}. Use bash (sed/head) to read the rest.]`;
        } else if (truncated) {
          text += `\n\n[Showing lines ${start + 1}-${endShown} of ${total}. Use offset=${endShown + 1} to continue.]`;
        }
        return ok('read_file', text, { path: abs, bytes: Buffer.byteLength(body), truncated });
      } catch (e) { return fail('read_file', e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'write_file', label: 'Write file',
    description: [
      'Create or overwrite a UTF-8 text file within the accessible repositories.',
      'Use only when you intend to replace the full file content.',
      'Prefer edit_file for localized changes. Output includes a human summary, details.diff for UI/review and details.patch (unified) for tooling.',
    ].join(' '),
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    execute: async (_id, p) => {
      try {
        const abs = ctx.assertPathAllowed(p.path);
        // Serialize the read-modify-write against other mutations of the SAME file (different files still
        // run in parallel) so a concurrent edit can't slip between the diff-baseline read and the write.
        return await withFileMutationQueue(abs, async () => {
          let before = null;
          try { before = readFileSync(abs, 'utf-8'); } catch { /* new file */ }
          writeFileSync(abs, p.content, 'utf-8');
          const base = before ?? '';
          const diff = displayDiff(base, p.content);
          const patch = unifiedPatch(abs, base, p.content);
          return ok('write_file', `Wrote ${Buffer.byteLength(p.content)} bytes to ${abs}`, {
            path: abs, bytes: Buffer.byteLength(p.content),
            ...(diff ? { diff } : {}), ...(patch ? { patch } : {}),
          });
        });
      } catch (e) { return fail('write_file', e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'edit_file', label: 'Edit file',
    description: [
      'Replace an exact text snippet in a UTF-8 file within the accessible repositories.',
      'Use for targeted edits after reading enough surrounding context.',
      'Matching tolerates smart quotes, Unicode dashes and trailing whitespace, and preserves the file BOM/CRLF. By default oldText must match exactly once; set replaceAll only when every occurrence should change.',
      'Output includes details.diff for review and details.patch (unified). If oldText is missing or ambiguous, read the file again and provide more context.',
    ].join(' '),
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute path to the file' }),
      oldText: Type.String({ description: 'Text to replace (whitespace/quote tolerant)' }),
      newText: Type.String({ description: 'Replacement text' }),
      replaceAll: Type.Optional(Type.Boolean({ description: 'Replace every occurrence (default false)' })),
    }),
    execute: async (_id, p) => {
      try {
        const abs = ctx.assertPathAllowed(p.path);
        // Serialize the read-modify-write against other mutations of the SAME file (different files still
        // run in parallel) so a concurrent write can't slip between the match read and the write.
        return await withFileMutationQueue(abs, async () => {
          const before = readFileSync(abs, 'utf-8');
          if (p.oldText === p.newText) return ok('edit_file', 'Error: oldText and newText are identical.', { ok: false, path: abs });
          const plan = planEdit(before, p.oldText, p.newText, p.replaceAll ?? false);
          if (plan.error === 'empty') return ok('edit_file', 'Error: oldText must not be empty.', { ok: false, path: abs });
          if (plan.error === 'notfound') return ok('edit_file', 'Error: oldText not found in the file. Match it exactly, including whitespace.', { ok: false, path: abs });
          if (plan.error === 'ambiguous') return ok('edit_file', `Error: oldText matches ${plan.count} times. Provide more context to make it unique, or set replaceAll.`, { ok: false, path: abs, matches: plan.count });
          if (plan.newContent === plan.content) return ok('edit_file', 'Error: the replacement produced identical content.', { ok: false, path: abs });
          writeFileSync(abs, plan.after, 'utf-8');
          const diff = displayDiff(plan.content, plan.newContent);
          const patch = unifiedPatch(abs, plan.content, plan.newContent);
          return ok('edit_file', `Edited ${abs} (${plan.count > 1 ? `${plan.count} replacements` : '1 replacement'})`, {
            path: abs, replacements: plan.count, ...(diff ? { diff } : {}), ...(patch ? { patch } : {}),
          });
        });
      } catch (e) { return fail('edit_file', e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'list_dir', label: 'List directory',
    description: [
      'List the entries of a directory within the accessible repositories.',
      'Use for focused navigation when you already know the directory.',
      'Do not use recursively; use search_files for codebase-wide discovery.',
    ].join(' '),
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id, p) => {
      try {
        const abs = ctx.assertPathAllowed(p.path);
        const entries = readdirSync(abs).map((n) => {
          try { return statSync(join(abs, n)).isDirectory() ? `${n}/` : n; } catch { return n; }
        });
        return ok('list_dir', entries.join('\n') || '(empty)', { path: abs, count: entries.length });
      } catch (e) { return fail('list_dir', e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'search_files', label: 'Search files',
    description: [
      'Search file names or UTF-8 file contents within an accessible repository path.',
      'Use for codebase discovery before reading or editing files. Prefer content mode for symbols/text and files mode for path/name lookup.',
      'Input path must be an accessible directory or file. Output is grouped matches with line numbers and is capped; details.truncated indicates more specific searches are needed.',
    ].join(' '),
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute path to search within' }),
      query: Type.String({ description: 'Literal text or regular expression to search for' }),
      mode: Type.Optional(Type.Union([Type.Literal('content'), Type.Literal('files')], { description: 'Search content (default) or file names' })),
      include: Type.Optional(Type.String({ description: 'Optional file glob, e.g. "*.ts", "**/*.tsx", or "*.{ts,tsx}"' })),
    }),
    execute: async (_id, p) => {
      try {
        const abs = ctx.assertPathAllowed(p.path);
        const mode = p.mode === 'files' ? 'files' : 'content';
        if (!String(p.query ?? '').trim()) return ok('search_files', 'Error: query is required.', { ok: false, path: abs });
        const root = statSync(abs).isDirectory() ? abs : dirname(abs);
        const queryText = String(p.query);
        const query = safeRegex(queryText);
        const include = globRegex(p.include);
        const lines = [];
        let rgOk = false;
        try {
          lines.push(...await rgSearch(abs, root, queryText, p.include, mode, searchMaxMatches));
          rgOk = true;
        } catch {
          // rg is optional on user machines. Fall back to a bounded JS walk when it is unavailable/errors.
        }
        // Only walk when rg was unavailable — a successful rg that found zero hits is a real empty result,
        // not a reason to re-scan. Walking anyway would disagree with rg (rg honors .gitignore, the walk
        // only SKIP_DIRS), so an otherwise-empty query could surface gitignored files on the fallback path.
        for (const file of rgOk ? [] : walkFiles(abs)) {
          const rel = relative(root, file) || file;
          if (include && !include.test(rel) && !include.test(rel.split('/').at(-1) ?? rel)) continue;
          if (mode === 'files') {
            if (query.test(rel)) lines.push(rel);
            if (lines.length >= searchMaxMatches) break;
            continue;
          }
          let body = '';
          try { body = readFileSync(file, 'utf-8'); } catch { continue; }
          const fileLines = body.split('\n');
          for (let i = 0; i < fileLines.length; i++) {
            if (!query.test(fileLines[i])) continue;
            lines.push(`${rel}:${i + 1}: ${fileLines[i]}`);
            if (lines.length >= searchMaxMatches) break;
          }
          if (lines.length >= searchMaxMatches) break;
        }
        // Cap each hit so one minified/very long match line can't flood the result set.
        const formatted = lines.map((l) => truncateLine(l, RESULT_LINE_MAX).text).join('\n');
        const truncated = lines.length >= searchMaxMatches;
        return ok('search_files', formatted || 'No matches found.', { path: abs, mode, matches: lines.length, truncated });
      } catch (e) { return fail('search_files', e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'file_info', label: 'File info',
    description: [
      'Inspect basic filesystem metadata for a file or directory inside accessible repositories.',
      'Use to verify existence, size, file type, and modification time before reading a large file or writing changes.',
      'Output is JSON so it can be parsed by the model.',
    ].join(' '),
    parameters: Type.Object({ path: Type.String({ description: 'Absolute path to inspect' }) }),
    execute: async (_id, p) => {
      try {
        const abs = ctx.assertPathAllowed(p.path);
        const s = statSync(abs);
        const info = { path: abs, type: s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'other', bytes: s.size, modifiedAt: s.mtime.toISOString() };
        return ok('file_info', JSON.stringify(info, null, 2), info);
      } catch (e) { return fail('file_info', e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'git_status', label: 'Git status',
    description: [
      'Report concise git repository state for an accessible project path.',
      'Use before/after edits to understand branch, dirty files, and staged changes.',
      'Do not use for arbitrary shell commands; it only runs safe git status/rev-parse commands.',
    ].join(' '),
    parameters: Type.Object({ path: Type.String({ description: 'Absolute repository path or file path inside it' }) }),
    execute: async (_id, p) => {
      try {
        const abs = ctx.assertPathAllowed(p.path);
        const cwd = statSync(abs).isDirectory() ? abs : dirname(abs);
        const run = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        const root = run(['rev-parse', '--show-toplevel']);
        ctx.assertPathAllowed(root);
        const branch = run(['branch', '--show-current']) || run(['rev-parse', '--short', 'HEAD']);
        const porcelain = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const lines = porcelain.split('\n').filter(Boolean);
        const out = [`branch ${branch}`, `root ${root}`, lines.length ? '' : 'clean', ...lines.slice(0, 120)];
        return ok('git_status', out.join('\n'), { root, branch, dirtyFiles: lines.length, truncated: lines.length > 120 });
      } catch (e) { return fail('git_status', e); }
    },
  }));

  ctx.logger.info('registered read_file, write_file, edit_file, list_dir, search_files, file_info, git_status');
}
