import { execFile } from 'node:child_process';
import { writeFile, access } from 'node:fs/promises';

/** The single seam between `elowen install`'s logic and the real system. Every apt/systemctl/certbot
 *  call, every file write and every `command -v` goes through here, so the install modules are
 *  unit-tested with a fake Runner and never touch the host. */
export interface ExecResult { code: number; stdout: string; stderr: string }

export interface Runner {
  /** Run a command, capturing output. Never rejects on a non-zero exit — inspect `.code`. `user`
   *  re-runs it as that unprivileged user via `sudo -u`; `input` is piped to stdin. */
  exec(cmd: string, args: string[], opts?: { user?: string; input?: string }): Promise<ExecResult>;
  /** Absolute path of a command on PATH (optionally as another user), or null when absent. */
  which(cmd: string, asUser?: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export function realRunner(): Runner {
  const run = (cmd: string, args: string[], input?: string): Promise<ExecResult> =>
    new Promise((resolve) => {
      const child = execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
        resolve({ code, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
      });
      if (input !== undefined) { child.stdin?.end(input); }
    });

  return {
    exec: (cmd, args, opts) =>
      opts?.user
        // -H so $HOME is the target user's (agent CLIs read ~/.config etc); login shell for full PATH.
        ? run('sudo', ['-u', opts.user, '-H', 'bash', '-lc', [cmd, ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')], opts.input)
        : run(cmd, args, opts?.input),
    which: async (cmd, asUser) => {
      const r = asUser
        ? await run('sudo', ['-u', asUser, '-H', 'bash', '-lc', `command -v '${cmd}'`])
        : await run('bash', ['-lc', `command -v '${cmd}'`]);
      const out = r.stdout.trim();
      return r.code === 0 && out ? out : null;
    },
    writeFile: (path, content) => writeFile(path, content, 'utf8'),
    exists: (path) => access(path).then(() => true, () => false),
  };
}
