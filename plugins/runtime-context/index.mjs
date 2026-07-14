// Runtime-context plugin: tells the model what "now" is. Registers a per-turn context provider (NOT a
// system-prompt fragment), so the timestamp is fresh every turn while the cached prompt prefix stays
// stable — no cache invalidation. Zero dependencies.
const DAYPARTS = [[5, 'early morning'], [9, 'morning'], [12, 'midday'], [17, 'afternoon'], [21, 'evening']];
const daypart = (h) => (DAYPARTS.find(([end]) => h < end)?.[1]) ?? 'night';

export function register(ctx) {
  // `ctx.timezone()` resolves THIS plugin's configured zone (the operator sets it right here, in Settings)
  // and is the same value the cron scheduler reads — so "what time is it for this user" is answered once,
  // in one place, and a schedule and the injected clock can never disagree. Read per turn, so changing the
  // setting applies immediately.
  ctx.registerTurnContext(() => {
    const timezone = ctx.timezone();
    // Format in that zone via Intl (no deps). new Date() is the wall clock at turn time.
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date()).reduce((a, p) => ((a[p.type] = p.value), a), {});
    const hour = Number(parts.hour);
    return `Current date & time: ${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} (${timezone}, ${daypart(hour)}).`;
  });

  ctx.logger.info(`runtime-context active (${ctx.timezone()})`);
}
