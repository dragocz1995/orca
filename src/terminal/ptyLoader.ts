// node-pty is an OPTIONAL dependency: it ships a native addon that may fail to build on a host
// without a toolchain. When it's absent the terminal layer degrades to the snapshot mirror, so we
// never hard-import it — we probe once via dynamic import and cache the result (including failure).

/** The slice of node-pty we use. Kept minimal so the rest of the module is testable with a fake. */
export interface IPty {
  onData(cb: (d: string) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface PtyModule {
  spawn(
    file: string,
    args: string[],
    opts: { name: string; cols: number; rows: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ): IPty;
}

let cached: { mod: PtyModule | null } | null = null;

/** Resolve the node-pty module, or null when it isn't installed/loadable. The result is memoised so
 *  the dynamic import happens at most once. `importer` is injectable for tests. */
export async function loadPty(importer: () => Promise<unknown> = () => import('node-pty')): Promise<PtyModule | null> {
  if (cached) return cached.mod;
  try {
    const mod = await importer();
    const m = mod as { spawn?: unknown };
    cached = { mod: typeof m.spawn === 'function' ? (m as PtyModule) : null };
  } catch {
    // Module missing or native addon failed to load — fall back to the snapshot mirror.
    cached = { mod: null };
  }
  return cached.mod;
}

/** Test seam: forget the memoised probe so a test can supply a different importer. */
export function resetPtyLoader(): void {
  cached = null;
}
