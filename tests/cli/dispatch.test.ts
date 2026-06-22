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
