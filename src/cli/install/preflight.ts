import type { Runner } from './runner.js';

/** Environment checks `orca install` runs before touching anything. Pure result + a human blocker
 *  list, so the wizard can refuse early with exact remediation. */
export interface PreflightResult {
  isRoot: boolean;
  pkgManager: 'apt' | null;
  node: { ok: boolean; version: string };
  tmux: boolean;
  /** C toolchain + python3 present — node-pty's native addon builds from source without them only via
   *  a prebuilt binary. NOT a blocker: absent → the installer apt-installs them, and if that fails the
   *  terminal stream simply degrades to the snapshot mirror. */
  buildTools: boolean;
}

const MIN_NODE_MAJOR = 22;

export async function preflight(r: Runner): Promise<PreflightResult> {
  const id = await r.exec('id', ['-u']);
  const node = await r.exec('node', ['-v']);
  const version = node.stdout.trim();
  const major = Number(version.replace(/^v/, '').split('.')[0]) || 0;
  return {
    isRoot: id.stdout.trim() === '0',
    pkgManager: (await r.which('apt-get')) ? 'apt' : null,
    node: { ok: major >= MIN_NODE_MAJOR, version },
    tmux: (await r.which('tmux')) !== null,
    buildTools: (await r.which('cc')) !== null && (await r.which('python3')) !== null,
  };
}

/** Hard blockers (must be empty to proceed). tmux is NOT a blocker — the wizard offers to apt-install
 *  it — so it isn't listed here. */
export function preflightBlockers(p: PreflightResult): string[] {
  const out: string[] = [];
  if (!p.isRoot) out.push('Must run as root — try: sudo orca install');
  if (!p.pkgManager) out.push('Unsupported OS: orca install needs apt (Debian/Ubuntu) in this version');
  if (!p.node.ok) out.push(`Node ${MIN_NODE_MAJOR}+ required (found ${p.node.version || 'none'})`);
  return out;
}
