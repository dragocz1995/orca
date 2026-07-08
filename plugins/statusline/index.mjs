// Statusline plugin: pure configuration — the daemon exposes these display toggles on /brain/status
// and the chat clients (web dock, elowen chat CLI) render the line. No tools, no prompt changes.
export function register(ctx) {
  ctx.logger.info('statusline display config active');
}
