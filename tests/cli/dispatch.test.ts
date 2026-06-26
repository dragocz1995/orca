import { describe, it, expect } from 'vitest';
import { run, needsDaemon } from '../../src/cli/index.js';
import type { OrcaClient } from '../../src/cli/client.js';

// The API-backed subcommands must keep working unchanged: `run` dispatches them against the client.
describe('cli/index.run (API subcommands unchanged)', () => {
  it('ls prints the task list from the client', async () => {
    const logs: string[] = [];
    const orig = console.log; console.log = (s) => logs.push(String(s));
    const client = { tasks: async () => [{ id: 't1' }] } as unknown as OrcaClient;
    try { await run(['ls'], client, {} as NodeJS.ProcessEnv); } finally { console.log = orig; }
    expect(logs.join('')).toContain('t1');
  });
});

describe('cli/index.run close flag parsing', () => {
  it('passes both flag values through when each has a value', async () => {
    let received: { summary?: string; outcome?: string } | undefined;
    const client = { close: async (_id: string, opts: { summary?: string; outcome?: string }) => { received = opts; } } as unknown as OrcaClient;
    const orig = console.log; console.log = () => {};
    try { await run(['close', 't1', '--summary', 'did the thing', '--outcome', 'ok'], client, {} as NodeJS.ProcessEnv); } finally { console.log = orig; }
    expect(received).toEqual({ summary: 'did the thing', outcome: 'ok' });
  });

  it('errors (exit 2) on a valueless --outcome instead of silently closing with none', async () => {
    const { exits, errs } = await runExpectingExit(['close', 't1', '--outcome']);
    expect(exits).toContain(2);
    expect(errs.join('')).toContain('--outcome requires a value');
  });

  it('does not swallow a following flag as the --summary value — it errors instead', async () => {
    const { exits, errs } = await runExpectingExit(['close', 't1', '--summary', '--outcome', 'ok']);
    expect(exits).toContain(2);
    expect(errs.join('')).toContain('--summary requires a value'); // '--outcome' was never captured as the summary
  });
});

// Run `close` expecting a process.exit; capture the codes and stderr instead of killing the test runner.
async function runExpectingExit(argv: string[]): Promise<{ exits: number[]; errs: string[] }> {
  const client = { close: async () => { throw new Error('close should not be reached'); } } as unknown as OrcaClient;
  const origExit = process.exit; const origErr = console.error;
  const exits: number[] = []; const errs: string[] = [];
  process.exit = ((code?: number) => { exits.push(code ?? 0); throw new Error('__exit__'); }) as unknown as typeof process.exit;
  console.error = (s?: unknown) => { errs.push(String(s)); };
  try { await run(argv, client, {} as NodeJS.ProcessEnv); } catch { /* the mocked exit throws to unwind */ }
  finally { process.exit = origExit; console.error = origErr; }
  return { exits, errs };
}

// Regression: only daemon-API verbs may auto-spawn the daemon. Help / unknown / install / lifecycle
// must not — a stray detached daemon would squat the port and starve the systemd service.
describe('cli/index.needsDaemon (auto-spawn gate)', () => {
  it('is true for API verbs', () => {
    for (const cmd of ['ls', 'ready', 'sessions', 'close', 'plan', 'overseer']) expect(needsDaemon(cmd)).toBe(true);
  });
  it('is false for help, version, install, lifecycle and unknown verbs', () => {
    for (const cmd of ['--help', '-h', 'help', '--version', 'install', 'up', 'down', 'status', 'update', 'wat', undefined]) {
      expect(needsDaemon(cmd)).toBe(false);
    }
  });
});
