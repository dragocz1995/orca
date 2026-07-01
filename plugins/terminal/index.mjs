// Terminal plugin: runs a shell command with the working directory confined to the caller's accessible
// repos (cwd guarded via ctx.assertPathAllowed). NOTE: the cwd is enforced, but a shell can still read
// absolute paths outside the repo — hard isolation (a jail/namespace) for untrusted roles is a deferred
// hardening step. Safe under the admin-trusted plugin model where the operator enables it deliberately.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { spawn } from 'node:child_process';

const MAX = 60_000;
const TIMEOUT_MS = 120_000;
const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });

function run(command, cwd) {
  return new Promise((done) => {
    const child = spawn(command, { cwd, shell: true, env: process.env });
    let out = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    const onData = (d) => { if (out.length < MAX) out += d.toString(); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      clearTimeout(timer);
      const body = out.length > MAX ? `${out.slice(0, MAX)}\n…[truncated]` : out;
      done(`$ ${command}\n(cwd: ${cwd})\n${killed ? '[killed: timeout]\n' : ''}${body}[exit ${code}]`);
    });
    child.on('error', (e) => { clearTimeout(timer); done(`Error: ${e.message}`); });
  });
}

export function register(ctx) {
  ctx.registerTool(defineTool({
    name: 'run_command', label: 'Run command',
    description: 'Run a shell command. The working directory is confined to your accessible repositories; '
      + 'pass cwd (a repo path) or it defaults to your first repo.',
    parameters: Type.Object({
      command: Type.String({ description: 'The shell command to run' }),
      cwd: Type.Optional(Type.String({ description: 'Working directory (must be within your repositories)' })),
    }),
    execute: async (_id, p) => {
      try {
        const roots = ctx.allowedRoots();
        const cwd = ctx.assertPathAllowed(p.cwd ?? roots[0] ?? process.cwd());
        return ok(await run(p.command, cwd));
      } catch (e) { return ok(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    },
  }));
  ctx.logger.info('registered run_command');
}
