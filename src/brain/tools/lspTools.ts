import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { LspManager, formatCheckResult } from '../../lsp/manager.js';
import { allowedRoots, assertPathAllowed, realPathWithin } from '../../plugins/pathGuard.js';
import { currentWorkDir } from '../../plugins/policyContext.js';
import { fileURLToPath } from 'node:url';

/** One daemon-wide LSP manager (owns the live language-server clients). Shared by the `LspDiagnostics`
 *  tool and the `/lsp` toggle so enabling/disabling and diagnostics hit the same servers. Lazily built so
 *  no server is spawned until the agent actually checks a file. */
let manager: LspManager | null = null;
export function lspManager(): LspManager {
  if (!manager) manager = new LspManager();
  return manager;
}

/** Current LSP diagnostics state WITHOUT building the manager (it defaults to enabled). Read by
 *  /brain/status so chat clients can show the live Active/Inactive state next to the `/lsp` toggle. */
export function lspEnabled(): boolean {
  return manager ? manager.isEnabled() : true;
}

/** Most-specific current-turn root containing the checked file. This is both the LSP search boundary
 *  and the security boundary: project marker discovery must never walk above a scoped user's repo. */
function lspBoundary(path: string): string | undefined {
  // An allowed repo is the hard security floor. Prefer it over a possibly deeper client cwd so a turn
  // launched from `<repo>/src` can still discover `<repo>/tsconfig.json` without ever reaching outside
  // the repo. All-access turns have no allowed roots, so their validated cwd is the useful fallback.
  const permitted = allowedRoots()
    .filter((root) => realPathWithin(path, [root]) !== null)
    .sort((a, b) => b.length - a.length)[0];
  if (permitted) return permitted;
  const workDir = currentWorkDir();
  return workDir && realPathWithin(path, [workDir]) !== null ? workDir : undefined;
}

/** The `/lsp` toggle: flip live diagnostics on/off and report the new state. Off frees every spawned
 *  server. Shared by the CLI `/lsp` command via the /brain/command dispatch. */
export function toggleLsp(): { enabled: boolean; message: string } {
  const mgr = lspManager();
  const enabled = !mgr.isEnabled();
  mgr.setEnabled(enabled);
  return { enabled, message: enabled ? 'LSP diagnostics ON — the agent can now type-check edits live.' : 'LSP diagnostics OFF — language servers stopped.' };
}

/** The owner-chat LSP toolset: an on-demand "did I break it?" probe the agent runs after editing a code
 *  file. Read-only (reads the file, queries its language server) → plan-mode safe. */
export function buildLspTools() {
  return [
    defineTool({
      name: 'LspDiagnostics', label: 'Check diagnostics',
      description: 'Type-check a file with its language server (LSP) and return errors/warnings with exact line:column. Call this right after editing a code file to immediately confirm it still compiles. Returns "no problems" for a clean file, and a clear note when LSP is off (/lsp) or no server is installed for the language.',
      parameters: Type.Object({ path: Type.String({ description: 'Absolute path to the file to check' }) }),
      execute: async (_id: string, p: { path: string }) => {
        // Same per-user path policy as every other file tool — without it a user scoped to one project
        // could feed ANY file on disk to a language server and read its content back through quoted
        // diagnostics. Reject with a plain error text (tools report, they don't throw).
        let path: string;
        try { path = assertPathAllowed(p.path); }
        catch (e) { return { content: [{ type: 'text' as const, text: `LSP: ${(e as Error).message}` }], details: {} }; }
        const result = await lspManager().checkFile(path, lspBoundary(path));
        const text = formatCheckResult(result) || `LSP: nothing to check for ${p.path}.`;
        return { content: [{ type: 'text' as const, text }], details: {} };
      },
    }),
    defineTool({
      name: 'LspGoToDefinition', label: 'Go to definition',
      description: 'Find where a symbol (function, class, variable) is defined using the language server. Returns the file path and line:column of the definition. Requires LSP to be enabled and a server installed for the file\'s language.',
      parameters: Type.Object({
        path: Type.String({ description: 'Absolute path to the file containing the symbol' }),
        line: Type.Number({ description: 'Line number (1-based) of the symbol' }),
        character: Type.Number({ description: 'Character offset (1-based) of the symbol' }),
      }),
      execute: async (_id: string, p: { path: string; line: number; character: number }) => {
        let path: string;
        try { path = assertPathAllowed(p.path); }
        catch (e) { return { content: [{ type: 'text' as const, text: `LSP: ${(e as Error).message}` }], details: {} }; }
        const result = await lspManager().definition(path, p.line, p.character, lspBoundary(path));
        return { content: [{ type: 'text' as const, text: formatLocations(result) ?? 'No definition found.' }], details: {} };
      },
    }),
    defineTool({
      name: 'LspFindReferences', label: 'Find references',
      description: 'Find all references to a symbol (function, class, variable) across the workspace using the language server. Returns a list of file:line:column locations. Requires LSP to be enabled and a server installed for the file\'s language.',
      parameters: Type.Object({
        path: Type.String({ description: 'Absolute path to the file containing the symbol' }),
        line: Type.Number({ description: 'Line number (1-based) of the symbol' }),
        character: Type.Number({ description: 'Character offset (1-based) of the symbol' }),
      }),
      execute: async (_id: string, p: { path: string; line: number; character: number }) => {
        let path: string;
        try { path = assertPathAllowed(p.path); }
        catch (e) { return { content: [{ type: 'text' as const, text: `LSP: ${(e as Error).message}` }], details: {} }; }
        const result = await lspManager().references(path, p.line, p.character, lspBoundary(path));
        return { content: [{ type: 'text' as const, text: formatLocations(result) ?? 'No references found.' }], details: {} };
      },
    }),
    defineTool({
      name: 'LspHover', label: 'Hover info',
      description: 'Get hover information (documentation, type signature) for a symbol at a position using the language server. Returns the symbol\'s type and doc comment. Requires LSP to be enabled and a server installed for the file\'s language.',
      parameters: Type.Object({
        path: Type.String({ description: 'Absolute path to the file containing the symbol' }),
        line: Type.Number({ description: 'Line number (1-based) of the symbol' }),
        character: Type.Number({ description: 'Character offset (1-based) of the symbol' }),
      }),
      execute: async (_id: string, p: { path: string; line: number; character: number }) => {
        let path: string;
        try { path = assertPathAllowed(p.path); }
        catch (e) { return { content: [{ type: 'text' as const, text: `LSP: ${(e as Error).message}` }], details: {} }; }
        const result = await lspManager().hover(path, p.line, p.character, lspBoundary(path));
        return { content: [{ type: 'text' as const, text: formatHover(result) ?? 'No hover information available.' }], details: {} };
      },
    }),
    defineTool({
      name: 'LspDocumentSymbol', label: 'Document symbols',
      description: 'List all symbols (functions, classes, variables, interfaces) in a file using the language server. Returns a hierarchical outline of the document. Requires LSP to be enabled and a server installed for the file\'s language.',
      parameters: Type.Object({
        path: Type.String({ description: 'Absolute path to the file' }),
      }),
      execute: async (_id: string, p: { path: string }) => {
        let path: string;
        try { path = assertPathAllowed(p.path); }
        catch (e) { return { content: [{ type: 'text' as const, text: `LSP: ${(e as Error).message}` }], details: {} }; }
        const result = await lspManager().documentSymbol(path, lspBoundary(path));
        return { content: [{ type: 'text' as const, text: formatDocumentSymbols(result) ?? 'No symbols found.' }], details: {} };
      },
    }),
    defineTool({
      name: 'LspWorkspaceSymbol', label: 'Workspace symbols',
      description: 'Search for symbols (functions, classes, variables) across the entire workspace by name using the language server. Returns matching symbols with their file locations. Requires LSP to be enabled and at least one server running.',
      parameters: Type.Object({
        query: Type.String({ description: 'Symbol name to search for (fuzzy match)' }),
      }),
      execute: async (_id: string, p: { query: string }) => {
        const result = await lspManager().workspaceSymbol(p.query, lspBoundary(p.query));
        return { content: [{ type: 'text' as const, text: formatWorkspaceSymbols(result) ?? 'No symbols found.' }], details: {} };
      },
    }),
  ];
}

// ── LSP result formatters ──────────────────────────────────────────────────────────────────────────

/** Convert a file URI to a plain path for display. */
function uriToPath(uri: string): string {
  try { return fileURLToPath(uri); } catch { return uri; }
}

/** Format a Location or Location[] or LocationLink[] result from definition/references. */
function formatLocations(result: unknown): string | null {
  if (!result) return null;
  const items = Array.isArray(result) ? result : [result];
  if (items.length === 0) return null;
  const lines: string[] = [];
  for (const item of items.slice(0, 30)) {
    const loc = item as { uri?: string; targetUri?: string; range?: { start?: { line?: number; character?: number } }; targetRange?: { start?: { line?: number; character?: number } } };
    const uri = loc.uri ?? loc.targetUri;
    const range = loc.range ?? loc.targetRange;
    if (!uri) continue;
    const path = uriToPath(uri);
    const line = (range?.start?.line ?? 0) + 1;
    const col = (range?.start?.character ?? 0) + 1;
    lines.push(`${path}:${line}:${col}`);
  }
  if (items.length > 30) lines.push(`… +${items.length - 30} more`);
  return lines.join('\n') || null;
}

/** Format a Hover result. */
function formatHover(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const hover = result as { contents?: unknown };
  const contents = hover.contents;
  if (!contents) return null;
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents.map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object' && 'value' in c) return String((c as { value: unknown }).value);
      return '';
    }).filter(Boolean).join('\n\n') || null;
  }
  if (typeof contents === 'object' && 'value' in contents) return String((contents as { value: unknown }).value);
  return null;
}

/** Format a DocumentSymbol[] result (hierarchical outline). */
function formatDocumentSymbols(result: unknown, indent = 0): string | null {
  if (!Array.isArray(result) || result.length === 0) return null;
  const lines: string[] = [];
  const pad = '  '.repeat(indent);
  for (const sym of result.slice(0, 50)) {
    const s = sym as { name?: string; kind?: number; range?: { start?: { line?: number } }; children?: unknown[] };
    const kindName = SYMBOL_KINDS[s.kind ?? 0] ?? 'symbol';
    const line = (s.range?.start?.line ?? 0) + 1;
    lines.push(`${pad}${s.name ?? '?'} (${kindName}) :${line}`);
    if (s.children?.length) {
      const childText = formatDocumentSymbols(s.children, indent + 1);
      if (childText) lines.push(childText);
    }
  }
  if (result.length > 50) lines.push(`${pad}… +${result.length - 50} more`);
  return lines.join('\n') || null;
}

/** Format a SymbolInformation[] result from workspace/symbol. */
function formatWorkspaceSymbols(result: unknown): string | null {
  if (!Array.isArray(result) || result.length === 0) return null;
  const lines: string[] = [];
  for (const sym of result.slice(0, 30)) {
    const s = sym as { name?: string; kind?: number; location?: { uri?: string; range?: { start?: { line?: number } } } };
    const kindName = SYMBOL_KINDS[s.kind ?? 0] ?? 'symbol';
    const path = s.location?.uri ? uriToPath(s.location.uri) : '?';
    const line = (s.location?.range?.start?.line ?? 0) + 1;
    lines.push(`${s.name ?? '?'} (${kindName}) ${path}:${line}`);
  }
  if (result.length > 30) lines.push(`… +${result.length - 30} more`);
  return lines.join('\n') || null;
}

/** LSP SymbolKind enum → human-readable name. */
const SYMBOL_KINDS: Record<number, string> = {
  1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class', 6: 'method',
  7: 'property', 8: 'field', 9: 'constructor', 10: 'enum', 11: 'interface',
  12: 'function', 13: 'variable', 14: 'constant', 15: 'string', 16: 'number',
  17: 'boolean', 18: 'array', 19: 'object', 20: 'key', 21: 'null', 22: 'enum-member',
  23: 'struct', 24: 'event', 25: 'operator', 26: 'type-parameter',
};
