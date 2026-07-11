import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const fixture = join(here, 'fixtures/cli-tmux-brain.mjs');
const cli = join(repo, 'dist/cli/bin.js');
const size = { columns: 96, rows: 24 };
const token = 'e2e-token';

if (spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status !== 0) {
  console.log('SKIP test:cli-tmux-short — tmux is not installed or not available on PATH.');
  process.exit(0);
}

const temp = mkdtempSync(join(tmpdir(), 'elowen-cli-tmux-short-'));
const artifactDir = mkdtempSync(join(tmpdir(), 'elowen-tui-short-artifacts-'));
const home = join(temp, 'home');
const config = join(temp, 'config');
const logPath = join(temp, 'mock-requests.jsonl');
const ttyStatePath = join(temp, 'tty-state.txt');
const terminalWriteLog = join(artifactDir, 'terminal-writes.log');
const perfLog = join(artifactDir, 'perf.jsonl');
const reportPath = join(artifactDir, 'report.json');
const session = `elowen-cli-short-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
mkdirSync(home, { recursive: true });
mkdirSync(config, { recursive: true });

let mock = null;
let failed = false;
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function tmux(args) {
  return execFileSync('tmux', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function hasSession() {
  return spawnSync('tmux', ['has-session', '-t', session], { stdio: 'ignore' }).status === 0;
}

function capture(ansi = false) {
  if (!hasSession()) return '';
  return tmux(['capture-pane', '-p', ...(ansi ? ['-e'] : []), '-t', session]);
}

function saveCapture(label) {
  const plain = capture();
  const ansi = capture(true);
  writeFileSync(join(artifactDir, `${label}.txt`), plain);
  writeFileSync(join(artifactDir, `${label}.ansi.txt`), ansi);
  return { plain, ansi };
}

function entries() {
  try {
    return readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function requests(path) {
  return entries().filter((entry) => entry.kind === 'request' && entry.path === path);
}

async function waitFor(label, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(30);
  }
  throw new Error(`timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

function sendLiteral(text) {
  tmux(['send-keys', '-t', session, '-l', '--', text]);
}

function sendKey(key) {
  tmux(['send-keys', '-t', session, key]);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function paneLines(value) {
  return value.endsWith('\n') ? value.slice(0, -1).split('\n') : value.split('\n');
}

function assertStableFrame(label, plain) {
  const lines = paneLines(plain);
  assert.equal(lines.length, size.rows, `${label}: pane must stay exactly ${size.rows} rows tall`);
  assert.ok(lines.every((line) => line.length <= size.columns), `${label}: no physical row may exceed ${size.columns} columns`);
  assert.equal((plain.match(/\bBuild\b/g) ?? []).length, 1, `${label}: status row must occur exactly once`);
}

async function startMock() {
  const child = spawn(process.execPath, [fixture], {
    cwd: repo,
    env: { ...process.env, ELOWEN_TMUX_LOG: logPath, ELOWEN_TMUX_SCENARIO: 'short-controls' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('exit', (code, signal) => {
    if (!failed && code !== 0) process.stderr.write(`mock brain exited early (${code ?? signal})\n${stderr}`);
  });
  const port = await waitFor('mock brain port', () => {
    const line = stdout.split('\n').find(Boolean);
    if (!line) return null;
    const parsed = JSON.parse(line);
    return Number.isInteger(parsed.port) ? parsed.port : null;
  }, 5_000);
  return { child, port };
}

try {
  const started = await startMock();
  mock = started.child;
  const base = `http://127.0.0.1:${started.port}`;
  const cliCommand = [
    'env',
    `HOME=${shellQuote(home)}`,
    `XDG_CONFIG_HOME=${shellQuote(config)}`,
    `ELOWEN_URL=${shellQuote(base)}`,
    `ELOWEN_TOKEN=${shellQuote(token)}`,
    'ELOWEN_AUTOSTART=0',
    'ELOWEN_TUI_PERF=1',
    `ELOWEN_TUI_LOG=${shellQuote(perfLog)}`,
    `PI_TUI_WRITE_LOG=${shellQuote(terminalWriteLog)}`,
    'TERM=xterm-256color',
    shellQuote(process.execPath), shellQuote(cli), 'chat', '--new',
  ].join(' ');
  const command = [
    'before=$(stty -g)', cliCommand, 'after=$(stty -g)',
    `printf '%s\\n%s\\n' "$before" "$after" > ${shellQuote(ttyStatePath)}`,
    `printf '\\nE2E SHORT SHELL RESTORED\\n'`, 'sleep 2',
  ].join('; ');

  tmux(['new-session', '-d', '-s', session, '-x', String(size.columns), '-y', String(size.rows), '-c', repo, command]);
  try { tmux(['set-option', '-t', session, 'window-size', 'manual']); } catch { /* older tmux */ }
  tmux(['resize-window', '-t', session, '-x', String(size.columns), '-y', String(size.rows)]);

  await waitFor('chat readiness', () => requests('/brain/stream').length === 1 && capture().includes('E2E Harness'));
  sendLiteral('Ahoj, jak se máš? :-)');
  sendKey('Enter');
  await waitFor('one short reply', () => capture().includes('E2E SHORT REPLY'));
  await waitFor('short idle event', () => entries().some((entry) => entry.kind === 'event' && entry.event?.usage?.totalTokens === 24));
  await sleep(100);

  const short = saveCapture('01-one-short-message');
  assertStableFrame('one short message', short.plain);
  assert.doesNotMatch(short.ansi, /\x1b\[7m {2,}/, 'one short message must not create a wide reverse-video padding line');

  sendLiteral('E2E CONTROL BURST');
  sendKey('Enter');
  await waitFor('rapid tool burst completion', () => capture().includes('E2E CONTROL BURST COMPLETE'));
  await waitFor('tool burst idle event', () => entries().some((entry) => entry.kind === 'event' && entry.event?.usage?.totalTokens === 3456));
  await sleep(120);

  const burst = saveCapture('02-rapid-tool-control-burst');
  assertStableFrame('rapid tool burst', burst.plain);
  assert.match(burst.plain, /E2E CONTROL BURST COMPLETE/, 'assistant tail must remain visible after rapid tool results');
  assert.ok(paneLines(burst.plain).some((line) => /█\s*$/.test(line)), 'overflowing transcript must expose a scrollbar thumb');
  assert.doesNotMatch(burst.ansi, /\t|\r|\x1b\]0;unsafe-title|\x1b\[2J/, 'tool payload controls must not escape into the terminal frame');

  sendKey('PageUp');
  await waitFor('PageUp history chip', () => capture().includes('History +'));
  const scrolled = saveCapture('03-page-up-after-burst');
  assertStableFrame('PageUp after burst', scrolled.plain);
  sendKey('PageDown');
  await waitFor('PageDown tail', () => !capture().includes('History +'));

  tmux(['resize-window', '-t', session, '-x', '40', '-y', '15']);
  await waitFor('compact stable frame', () => capture().includes('Build') && paneLines(capture()).length === 15);
  tmux(['resize-window', '-t', session, '-x', String(size.columns), '-y', String(size.rows)]);
  await waitFor('restored frame', () => capture().includes('E2E CONTROL BURST COMPLETE') && paneLines(capture()).length === size.rows);
  const restored = saveCapture('04-restored-after-resize');
  assertStableFrame('restored after resize', restored.plain);

  sendKey('C-c');
  await waitFor('single stop', () => requests('/brain/session/stop').length === 1);
  await waitFor('restored shell', () => capture().includes('E2E SHORT SHELL RESTORED'), 5_000);
  saveCapture('05-restored-shell');

  const ttyStates = readFileSync(ttyStatePath, 'utf8').trim().split('\n');
  assert.equal(ttyStates[1], ttyStates[0], 'raw/canonical/echo tty state must be restored exactly');
  const terminalWrites = readFileSync(terminalWriteLog, 'utf8');
  assert.ok(terminalWrites.lastIndexOf('\x1b[?1049l') > terminalWrites.lastIndexOf('\x1b[?1049h'), 'alternate screen must be left last');
  assert.ok(terminalWrites.lastIndexOf('\x1b[?1006l') > terminalWrites.lastIndexOf('\x1b[?1006h'), 'mouse reporting must be disabled last');

  const frames = readFileSync(perfLog, 'utf8').split('\n').filter(Boolean)
    .map((line) => JSON.parse(line)).filter((entry) => entry.type === 'frame');
  assert.ok(frames.length > 0, 'perf diagnostics must contain frames');
  assert.ok(frames.every((frame) => frame.rootRows <= frame.terminal.rows), 'every diagnosed root frame must fit the terminal');
  const scrollFrames = frames.filter((frame) => frame.reasons?.some((reason) => reason.includes('scroll')));
  const report = {
    passed: true,
    captures: 5,
    frames: frames.length,
    scrollFrames: scrollFrames.length,
    shortPaddingArtifact: false,
    toolControlsContained: true,
    scrollbarVisible: true,
    terminalStateRestored: true,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PASS test:cli-tmux-short — one-message white-line regression, rapid control-rich tool stream, scrollbar, resize, and teardown verified. Report: ${reportPath}`);
} catch (error) {
  failed = true;
  process.stderr.write(`FAIL test:cli-tmux-short — ${error.stack ?? error}\n`);
  const pane = capture();
  if (pane) process.stderr.write(`\n--- tmux capture ---\n${pane}\n`);
  try { writeFileSync(reportPath, `${JSON.stringify({ passed: false, error: error.stack ?? String(error) }, null, 2)}\n`); } catch { /* best effort */ }
  process.stderr.write(`Machine report: ${reportPath}\n`);
  process.exitCode = 1;
} finally {
  if (hasSession()) spawnSync('tmux', ['kill-session', '-t', session], { stdio: 'ignore' });
  if (mock && mock.exitCode === null && mock.signalCode === null) {
    mock.kill('SIGTERM');
    await Promise.race([new Promise((resolveExit) => mock.once('exit', resolveExit)), sleep(1_000)]);
    if (mock.exitCode === null && mock.signalCode === null) mock.kill('SIGKILL');
  }
  rmSync(temp, { recursive: true, force: true });
}
