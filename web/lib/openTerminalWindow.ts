/** Pop a session's terminal out into its own chromeless browser window (the `/terminal/[name]` route).
 *  Keyed by session name so re-opening focuses the existing window instead of stacking duplicates. */
export function openTerminalWindow(name: string): void {
  window.open(
    `/terminal/${encodeURIComponent(name)}`,
    `elowen-terminal-${name}`,
    'width=900,height=600,noopener',
  );
}
