// Discord platform plugin: a dependency-free gateway client (Node's global WebSocket + fetch).
// The bot answers when mentioned in a server; the sender's Discord roles resolve — via this plugin's
// own rolePolicies config — to the Orca projects they may touch plus an extra role prompt (the Hermes
// role-instructions pattern). Unmapped senders (and DMs, which carry no roles) are ignored.
//
// On top of plain chat it provides: slash commands (/model, /new, /help), a per-channel model picker
// (select menu, choice persisted), live streaming replies (edit-in-place with a tool-call trace), a
// typing indicator, and proactive pushes (cron/tick echoes) via notify().
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
// GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);
const EDIT_THROTTLE_MS = 1200; // Discord allows ~5 edits / 5 s per channel — stay under it
const CHUNK = 1990;

/** Split text into ≤CHUNK pieces WITHOUT breaking a fenced code block: if a cut lands inside ``` … ```,
 *  close the fence on this piece and reopen it (same language) on the next. Prefers newline cuts. */
export function splitContent(text) {
  const pieces = [];
  let rest = text;
  let reopen = '';
  while (rest.length > CHUNK) {
    let cut = rest.lastIndexOf('\n', CHUNK);
    if (cut < CHUNK * 0.5) cut = CHUNK; // no good newline → hard cut
    let piece = reopen + rest.slice(0, cut);
    rest = rest.slice(cut);
    // Count fences in this piece; an odd count means we're mid-block → close + remember to reopen.
    const fences = piece.match(/```/g)?.length ?? 0;
    if (fences % 2 === 1) {
      const lang = /```([^\n`]*)\n[^]*$/.exec(piece)?.[1] ?? '';
      piece += '\n```';
      reopen = '```' + lang + '\n';
    } else {
      reopen = '';
    }
    pieces.push(piece);
  }
  pieces.push(reopen + rest);
  return pieces;
}

/** Per-channel state: chosen model + a conversation "generation" (/new bumps it → fresh session). */
class StateStore {
  constructor(file) { this.file = file; this.cache = null; }
  all() {
    if (this.cache) return this.cache;
    try { this.cache = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf-8')) : {}; }
    catch { this.cache = {}; }
    return this.cache;
  }
  get(channelId) { return this.all()[channelId] ?? {}; }
  patch(channelId, fields) {
    const all = this.all();
    all[channelId] = { ...all[channelId], ...fields };
    this.cache = all;
    try { writeFileSync(this.file, JSON.stringify(all, null, 2)); } catch { /* best-effort persistence */ }
  }
}

class DiscordAdapter {
  name = 'discord';
  constructor(cfg, logger, state, listModels) {
    this.cfg = cfg;
    this.log = logger;
    this.state = state;
    this.listModels = listModels;
    this.handler = null;
    this.ws = null;
    this.botId = null;
    this.appId = null;
    this.stopped = false;
    this.seq = null;
    this.backoffMs = 1000;
    this.sessionId = null;    // gateway session for RESUME
    this.resumeUrl = null;    // gateway host to RESUME against
    this.awaitingAck = false; // heartbeat sent, ACK (op 11) not yet seen → zombie detection
  }

  listen(onMessage) { this.handler = onMessage; }

  async connect() {
    // Validate the token up front so a bad config fails loudly at startup, not silently in the gateway.
    const me = await this.rest('GET', '/users/@me');
    this.botId = me.id;
    const app = await this.rest('GET', '/oauth2/applications/@me').catch(() => null);
    this.appId = app?.id ?? me.id;
    await this.registerCommands().catch((e) => this.log.error(`slash command registration failed: ${e?.message ?? e}`));
    this.openGateway();
  }

  disconnect() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    try { this.ws?.close(); } catch { /* already closed */ }
  }

  /** Register the bot's slash commands. Guild-scoped when a guildId is set (instant), else global.
   *  Fingerprint the payload so an unchanged set skips the PUT — avoids needless syncs + rate limits. */
  async registerCommands() {
    const commands = [
      { name: 'model', description: 'Pick the AI model for this channel', type: 1 },
      { name: 'new', description: 'Start a fresh conversation in this channel', type: 1 },
      { name: 'help', description: 'What can Orca do here?', type: 1 },
    ];
    const path = this.cfg.guildId
      ? `/applications/${this.appId}/guilds/${this.cfg.guildId}/commands`
      : `/applications/${this.appId}/commands`;
    const fingerprint = `${this.appId}:${this.cfg.guildId ?? 'global'}:${JSON.stringify(commands)}`;
    if (this.state.get('__meta').commandFingerprint === fingerprint) return; // unchanged → skip
    await this.rest('PUT', path, commands);
    this.state.patch('__meta', { commandFingerprint: fingerprint });
  }

  openGateway() {
    if (this.stopped) return;
    const ws = new WebSocket(this.sessionId && this.resumeUrl ? `${this.resumeUrl}?v=10&encoding=json` : GATEWAY);
    this.ws = ws;
    ws.onmessage = (ev) => this.onFrame(JSON.parse(String(ev.data)));
    ws.onclose = () => {
      clearInterval(this.heartbeat);
      if (this.stopped) return;
      setTimeout(() => this.openGateway(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    };
    ws.onerror = () => { /* onclose follows and handles the retry */ };
  }

  onFrame(frame) {
    if (frame.s) this.seq = frame.s;
    if (frame.op === 10) {
      clearInterval(this.heartbeat);
      this.awaitingAck = false;
      this.heartbeat = setInterval(() => {
        if (this.awaitingAck) { try { this.ws?.close(); } catch { /* onclose reconnects */ } return; }
        this.awaitingAck = true;
        this.send({ op: 1, d: this.seq });
      }, frame.d.heartbeat_interval);
      if (this.sessionId) this.send({ op: 6, d: { token: this.cfg.botToken, session_id: this.sessionId, seq: this.seq } });
      else this.send({ op: 2, d: { token: this.cfg.botToken, intents: INTENTS, properties: { os: 'linux', browser: 'orca', device: 'orca' } } });
      return;
    }
    if (frame.op === 11) { this.awaitingAck = false; return; }
    if (frame.op === 0 && frame.t === 'READY') {
      this.backoffMs = 1000;
      this.sessionId = frame.d.session_id ?? null;
      this.resumeUrl = frame.d.resume_gateway_url ?? null;
      this.log.info('discord gateway ready');
      return;
    }
    if (frame.op === 0 && frame.t === 'RESUMED') { this.backoffMs = 1000; return; }
    if (frame.op === 0 && frame.t === 'MESSAGE_CREATE') void this.onMessage(frame.d).catch((e) => this.log.error(`message handling failed: ${e?.message ?? e}`));
    if (frame.op === 0 && frame.t === 'INTERACTION_CREATE') void this.onInteraction(frame.d).catch((e) => this.log.error(`interaction failed: ${e?.message ?? e}`));
    if (frame.op === 7) { try { this.ws?.close(); } catch { /* reconnect via onclose */ } }
    if (frame.op === 9) {
      if (!frame.d) { this.sessionId = null; this.resumeUrl = null; this.seq = null; }
      try { this.ws?.close(); } catch { /* reconnect via onclose */ }
    }
  }

  send(obj) { try { this.ws?.send(JSON.stringify(obj)); } catch { /* gateway down; reconnect handles it */ } }

  /** Resolve a Discord message's sender to an access descriptor (role → projects/prompt + channel model). */
  accessFor(m, channelId) {
    const roleIds = m.member?.roles ?? [];
    const policies = Array.isArray(this.cfg.rolePolicies) ? this.cfg.rolePolicies : [];
    const match = policies.find((p) => p.roleId && roleIds.includes(p.roleId));
    if (!match) return { roleIds, access: undefined };
    const chosen = this.state.get(channelId).model;
    return {
      roleIds,
      access: {
        projectIds: (match.projectIds ?? []).map(Number),
        prompt: rolePrompt(match),
        model: chosen ? { provider: chosen.provider, model: chosen.model } : undefined,
      },
    };
  }

  async onMessage(m) {
    if (!this.handler || m.author?.bot) return;
    if (!m.guild_id) return; // DMs carry no member roles → no policy can ever match; ignore them
    if (this.cfg.guildId && m.guild_id !== this.cfg.guildId) return;
    if (!(m.mentions ?? []).some((u) => u.id === this.botId)) return; // only answer when addressed

    const text = String(m.content ?? '').replaceAll(`<@${this.botId}>`, '').replaceAll(`<@!${this.botId}>`, '').trim();
    if (!text) return;

    // The conversation key folds in the /new "generation" so a reset yields a clean session.
    const gen = this.state.get(m.channel_id).gen ?? 0;
    const convoKey = `${m.channel_id}#${gen}`;
    const { roleIds, access } = this.accessFor(m, m.channel_id);
    if (!access) return; // unmapped sender → stay silent

    const reactions = this.cfg.reactions !== false;
    const streaming = this.cfg.streaming !== false;
    const stream = streaming ? new LiveMessage(this, m.channel_id) : null;
    const typing = setInterval(() => void this.rest('POST', `/channels/${m.channel_id}/typing`, {}).catch(() => {}), 8000);
    void this.rest('POST', `/channels/${m.channel_id}/typing`, {}).catch(() => {});
    if (reactions) void this.react(m.channel_id, m.id, '👀').catch(() => {}); // status: seen

    try {
      const reply = await this.handler(
        { platform: 'discord', userId: m.author.id, roleIds, channelId: convoKey, access },
        text,
        stream ? (e) => stream.onEvent(e) : undefined,
      );
      clearInterval(typing);
      if (stream) await stream.finalize(reply);
      else if (reply) await this.reply(m.channel_id, reply);
      if (reactions) { await this.unreact(m.channel_id, m.id, '👀').catch(() => {}); void this.react(m.channel_id, m.id, '✅').catch(() => {}); }
    } catch (e) {
      clearInterval(typing);
      if (reactions) { await this.unreact(m.channel_id, m.id, '👀').catch(() => {}); void this.react(m.channel_id, m.id, '❌').catch(() => {}); }
      await this.reply(m.channel_id, `⚠️ ${e?.message ?? e}`).catch(() => {});
    }
  }

  react(channelId, messageId, emoji) {
    return this.rest('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, {});
  }
  unreact(channelId, messageId, emoji) {
    return this.rest('DELETE', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, {});
  }

  async onInteraction(i) {
    // ACK-and-respond for slash commands (type 2) and component interactions (type 3).
    if (i.type === 2) {
      const name = i.data?.name;
      if (name === 'help') return this.respond(i, 4, { content: HELP, flags: 64 });
      if (name === 'new') {
        const gen = (this.state.get(i.channel_id).gen ?? 0) + 1;
        this.state.patch(i.channel_id, { gen });
        return this.respond(i, 4, { content: '🐋 Fresh conversation started in this channel.', flags: 64 });
      }
      if (name === 'model') {
        const models = (await this.listModels().catch(() => [])).slice(0, 25);
        if (models.length === 0) return this.respond(i, 4, { content: 'No models configured yet (Settings → Orca AI).', flags: 64 });
        const current = this.state.get(i.channel_id).model;
        const options = models.map((mo) => ({
          label: mo.model.slice(0, 100),
          value: `${mo.provider}::${mo.model}`.slice(0, 100),
          description: mo.providerLabel.slice(0, 100),
          default: !!current && current.provider === mo.provider && current.model === mo.model,
        }));
        return this.respond(i, 4, {
          content: 'Pick the model for this channel:',
          flags: 64,
          components: [{ type: 1, components: [{ type: 3, custom_id: 'pick_model', options, placeholder: 'Choose a model…' }] }],
        });
      }
    }
    if (i.type === 3 && i.data?.custom_id === 'pick_model') {
      const [provider, model] = String(i.data.values?.[0] ?? '').split('::');
      if (provider && model) this.state.patch(i.channel_id, { model: { provider, model } });
      return this.respond(i, 7, { content: `✅ Model set to **${model}**.`, components: [] });
    }
  }

  /** Send an interaction callback (type 4 = message, 7 = update the component message). */
  async respond(i, type, data) {
    await this.rest('POST', `/interactions/${i.id}/${i.token}/callback`, { type, data });
  }

  async reply(channelId, text) {
    for (const piece of splitContent(text)) {
      await this.rest('POST', `/channels/${channelId}/messages`, { content: piece });
    }
  }

  /** Host-initiated push (cron/tick echoes) → the configured notification channel. No-op without one. */
  async notify(text) {
    const channelId = typeof this.cfg.notifyChannelId === 'string' ? this.cfg.notifyChannelId.trim() : '';
    if (!channelId) return;
    await this.reply(channelId, text);
  }

  async rest(method, path, body, attempt = 0) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bot ${this.cfg.botToken}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 3) {
      const wait = (Number(res.headers.get('retry-after')) || 1) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return this.rest(method, path, body, attempt + 1);
    }
    if (!res.ok) throw new Error(`discord API ${method} ${path} → HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
}

/** A single reply message that streams: post once, then edit-in-place (throttled) as text + tool-call
 *  chips arrive, and split into extra messages if the final answer exceeds Discord's 2000-char cap. */
class LiveMessage {
  constructor(adapter, channelId) {
    this.a = adapter;
    this.channelId = channelId;
    this.messageId = null;
    this.text = '';
    this.tools = [];
    this.lastEdit = 0;
    this.pending = null;
  }
  render() {
    const chips = this.tools.length ? this.tools.map((t) => `\`🔧 ${t}\``).join(' ') + '\n' : '';
    return (chips + this.text).slice(0, CHUNK) || '🐋 …';
  }
  async ensure() {
    if (this.messageId) return;
    const msg = await this.a.rest('POST', `/channels/${this.channelId}/messages`, { content: '🐋 …' }).catch(() => null);
    this.messageId = msg?.id ?? null;
  }
  onEvent(e) {
    if (e.type === 'text' && e.delta) this.text += e.delta;
    else if (e.type === 'tool' && e.name) this.tools.push(e.name);
    else return;
    void this.throttledEdit();
  }
  async throttledEdit() {
    const now = Date.now();
    if (now - this.lastEdit < EDIT_THROTTLE_MS) { this.pending = true; return; }
    this.lastEdit = now;
    await this.ensure();
    if (!this.messageId) return;
    await this.a.rest('PATCH', `/channels/${this.channelId}/messages/${this.messageId}`, { content: this.render() }).catch(() => {});
    if (this.pending) { this.pending = false; setTimeout(() => void this.throttledEdit(), EDIT_THROTTLE_MS); }
  }
  async finalize(reply) {
    const full = reply || this.text || '(no response)';
    const chips = this.tools.length ? this.tools.map((t) => `\`🔧 ${t}\``).join(' ') + '\n' : '';
    const pieces = splitContent(chips + full);
    await this.ensure();
    if (this.messageId) await this.a.rest('PATCH', `/channels/${this.channelId}/messages/${this.messageId}`, { content: pieces[0] }).catch(() => {});
    else await this.a.rest('POST', `/channels/${this.channelId}/messages`, { content: pieces[0] }).catch(() => {});
    for (const piece of pieces.slice(1)) {
      await this.a.rest('POST', `/channels/${this.channelId}/messages`, { content: piece }).catch(() => {});
    }
  }
}

const HELP = [
  '**Orca on Discord**',
  'Mention me and I answer from the Orca brain.',
  '',
  '`/model` — pick the AI model for this channel',
  '`/new` — start a fresh conversation here',
  '`/help` — this message',
].join('\n');

function rolePrompt(policy) {
  const parts = [];
  if (policy.name) parts.push(`The user you are talking to has the "${policy.name}" role.`);
  if (policy.prompt) parts.push(policy.prompt);
  return parts.join('\n') || undefined;
}

export function register(ctx) {
  const token = typeof ctx.config.botToken === 'string' ? ctx.config.botToken.trim() : '';
  if (!token) { ctx.logger.warn('enabled but no botToken configured — not connecting'); return; }
  const state = new StateStore(join(ctx.dataDir(), 'channel-state.json'));
  ctx.registerPlatform(new DiscordAdapter({ ...ctx.config, botToken: token }, ctx.logger, state, ctx.listModels));
  ctx.logger.info('discord platform registered (slash commands + model picker + streaming)');
}
