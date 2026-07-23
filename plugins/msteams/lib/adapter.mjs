// The Microsoft Teams adapter: inbound Bot Framework activities from the daemon's /hooks webhook,
// outbound replies through the Bot Connector REST API. The webhook handler answers 200 immediately and
// runs the brain turn async — the connector delivers the reply, never the HTTP response (Microsoft's
// callback deadline is far shorter than a long agent turn).
import { ConnectorClient } from './connector.mjs';
import { makeTokenVerifier } from './auth.mjs';
import { matchesId, senderIds, senderIsAdmin, displayNameOf } from './ids.mjs';
import { parseModelExec, splitContent } from './format.mjs';
import { MESSAGES } from './messages.mjs';

const MAX_IMAGE_BYTES = 5242880;
const MAX_IMAGES = 4;
const TYPING_INTERVAL_MS = 8000;

/** Read a numeric config field, clamped to [min,max], falling back to `def` when unset/invalid. */
function cfgNum(cfg, key, def, min, max) {
  return Math.min(Math.max(Number(cfg?.[key]) || def, min), max);
}

/** A rolePolicy's extra per-role instructions, spliced into the turn's system prompt. */
function rolePrompt(policy) {
  const parts = [];
  if (policy.name) parts.push(`The user you are talking to has the "${policy.name}" role.`);
  if (policy.prompt) parts.push(policy.prompt);
  return parts.join('\n') || undefined;
}

export class MsTeamsAdapter {
  name = 'msteams';
  constructor(cfg, logger, state, listModels, imageDirs = [], resolveProvider = () => null, answerQuestion = () => false, chatCommands = () => []) {
    this.cfg = cfg;
    this.log = logger;
    this.state = state;
    this.listModels = listModels;
    this.resolveProvider = resolveProvider;
    this.imageDirs = imageDirs;
    this.answerQuestion = answerQuestion; // parked AskUserQuestion delivery (wired up in the cards phase)
    this.chatCommands = chatCommands;
    this.handler = null;
    this.ctl = null;
    this.stopped = false;
    this.connector = new ConnectorClient(cfg, logger);
    this.verifyToken = makeTokenVerifier(cfg, logger);
    this.upnCache = new Map(); // from.id → UPN/email resolved via the conversation roster
    this.msg = MESSAGES[cfg.language === 'cs' ? 'cs' : 'en'];
  }

  listen(onMessage) { this.handler = onMessage; }
  control(api) { this.ctl = api; }

  /** Validate the credentials eagerly so a typo'd secret surfaces at enable time, not on the first
   *  message. A failure logs and keeps the adapter up — inbound validation still guards the webhook. */
  async connect() {
    try {
      await this.connector.token();
      this.log.info(`msteams connected (app ${this.cfg.appId})`);
    } catch (e) {
      this.log.warn(`msteams credential check failed: ${e?.message ?? e}`);
    }
  }

  disconnect() { this.stopped = true; }

  // ── inbound (the /hooks/msteams/messages handler) ──

  async handleWebhook(req) {
    if (req.method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
    let activity;
    try { activity = await req.json(); } catch { return { status: 400, body: { error: 'invalid JSON' } }; }
    if (!(await this.verifyToken(req.headers.authorization, activity))) return { status: 401, body: { error: 'unauthorized' } };
    if (this.stopped || !this.handler) return { status: 200, body: {} };

    if (activity?.type === 'message') {
      // Answer the callback NOW; the turn runs async and replies through the connector.
      void this.onActivity(activity).catch((e) => this.log.error(`msteams turn failed: ${e?.message ?? e}`));
      return { status: 200, body: {} };
    }
    if (activity?.type === 'conversationUpdate') {
      this.rememberConversation(activity);
      return { status: 200, body: {} };
    }
    return { status: 200, body: {} };
  }

  /** Persist where we can reach this conversation later (replies after the callback died, proactive
   *  notify): the serviceUrl travels on every inbound activity and may rotate between regions. Writes
   *  only on change — this runs per message and the ref is almost always already current. */
  rememberConversation(activity) {
    const conv = activity?.conversation;
    if (!conv?.id || typeof activity?.serviceUrl !== 'string') return;
    const ref = {
      serviceUrl: activity.serviceUrl,
      conversationType: conv.conversationType,
      tenantId: conv.tenantId,
      botId: activity.recipient?.id,
    };
    const prior = this.state.get(String(conv.id)).ref;
    if (JSON.stringify(prior) !== JSON.stringify(ref)) this.state.patch(String(conv.id), { ref });
    if (this.state.get('_meta').serviceUrl !== activity.serviceUrl) this.state.patch('_meta', { serviceUrl: activity.serviceUrl });
  }

  /** Whether a shared-chat message is addressed to the bot: Teams marks the bot's own mention with an
   *  entity whose `mentioned.id` equals our recipient id. */
  isForMe(activity) {
    const botId = activity.recipient?.id;
    if (!botId) return false;
    for (const e of activity.entities ?? []) {
      if (e?.type === 'mention' && e.mentioned?.id === botId) return true;
    }
    return false;
  }

  /** Remove `<at>…</at>` mention spans (the bot's own mention text) and collapse whitespace. */
  stripMention(text) {
    return String(text ?? '').replace(/<at>[^<]*<\/at>/gi, '').replace(/\s+/g, ' ').trim();
  }

  /** Resolve a sender to an access descriptor (rolePolicy → projects/prompt + per-chat model). Returns
   *  `access: undefined` for an unmapped sender → the turn is dropped silently. */
  accessFor(ids, conversationId) {
    const policies = Array.isArray(this.cfg.rolePolicies) ? this.cfg.rolePolicies : [];
    const match = policies.find((p) => p.roleId && ids.some((id) => matchesId(p.roleId, id)));
    if (!match) return { access: undefined };
    const st = this.state.get(String(conversationId));
    const chosen = st.model;
    return {
      access: {
        // admin:true = the operator's admin identity — full project scope + the full plugin toolset
        // (trusted-chat). It does NOT grant the owner's Elowen* control-plane tools or API token.
        admin: match.admin === true,
        projectIds: (match.projectIds ?? []).map(Number),
        prompt: rolePrompt(match),
        model: chosen ? { provider: chosen.provider, model: chosen.model } : undefined,
        thinkingLevel: typeof st.thinkingLevel === 'string' ? st.thinkingLevel : undefined,
        fast: st.fast === true,
        tools: Array.isArray(match.tools) && match.tools.length > 0 ? match.tools : undefined,
      },
    };
  }

  /** The sender's UPN/email via the conversation roster (bot API, no Graph permission), cached per
   *  account id. Best-effort — a failed lookup just narrows policy matching to id/GUID forms. */
  async resolveUpn(serviceUrl, conversationId, from) {
    if (!from?.id) return undefined;
    if (this.upnCache.has(from.id)) return this.upnCache.get(from.id);
    try {
      const member = await this.connector.member(serviceUrl, conversationId, from.id);
      const upn = member?.userPrincipalName || member?.email || undefined;
      this.upnCache.set(from.id, upn);
      return upn;
    } catch {
      this.upnCache.set(from.id, undefined);
      return undefined;
    }
  }

  async onActivity(m) {
    const conv = m.conversation;
    const from = m.from;
    if (!conv?.id || !from || from.id === m.recipient?.id) return; // no conversation, or our own echo
    this.rememberConversation(m);

    // Personal chats always respond. Group chats respond per config; a team-channel post reaches the
    // bot only when @mentioned anyway, and the mention gate doubles as the guard for group chats too.
    const kind = conv.conversationType ?? 'personal';
    if (kind !== 'personal' && this.cfg.respondWithoutMention === false && !this.isForMe(m)) return;

    const upn = await this.resolveUpn(m.serviceUrl, conv.id, from);
    const ids = senderIds(from, conv.id, upn);
    const { access } = this.accessFor(ids, conv.id);
    if (!access) return; // unmapped sender → stay silent

    let text = this.stripMention(m.text);
    const { images, notes } = await this.collectMedia(m);
    if (notes.length) text = [text, ...notes].filter(Boolean).join('\n');
    if (!text && images.length) text = '[The user sent an image]';
    if (!text) return;

    // Chat sessions are SHARED (one conversation per chat), so every message names its speaker.
    const senderName = displayNameOf(from);
    const prefixed = `[${senderName}] ${text}`;

    const gen = this.state.get(String(conv.id)).gen ?? 0;
    const convoKey = `${conv.id}#${gen}`;

    const typing = setInterval(() => void this.connector.typing(m.serviceUrl, conv.id).catch(() => {}), TYPING_INTERVAL_MS);
    void this.connector.typing(m.serviceUrl, conv.id).catch(() => {});

    // Image turns steer to the configured vision model — the chat's normal model may be text-only.
    const vision = images.length ? parseModelExec(this.cfg.visionModel) : null;
    let turnAccess = access;
    if (vision) {
      const models = await this.listModels().catch(() => []);
      const visionOption = models.find((mo) => mo.model === vision.model && (!vision.provider || mo.provider === vision.provider));
      turnAccess = { ...access, model: vision, ...(!visionOption?.fastAvailable ? { fast: false } : {}) };
    }

    try {
      const replyText = await this.handler(
        {
          platform: 'msteams', userId: String(from.aadObjectId || from.id), userName: senderName, roleIds: ids,
          channelId: convoKey, access: turnAccess,
          channelName: kind !== 'personal' ? (conv.name || undefined) : undefined,
          images: images.length ? images : undefined,
        },
        prefixed,
        undefined, // live trace + ask cards arrive with the streaming phase
      );
      clearInterval(typing);
      if (replyText) await this.deliver(m, replyText);
    } catch (e) {
      clearInterval(typing);
      await this.deliver(m, this.msg.error(e?.message ?? e)).catch(() => {});
    }
  }

  /** Post a (possibly long) markdown reply threaded under the inbound activity, split code-fence-aware. */
  async deliver(m, text) {
    for (const piece of splitContent(String(text))) {
      await this.connector.reply(m.serviceUrl, m.conversation.id, m.id, { type: 'message', textFormat: 'markdown', text: piece });
    }
  }

  /** Vision-ready images from the activity's attachments (downloaded + base64, capped) and textual notes
   *  for everything else. Teams duplicates the message body as a text/html attachment — skipped. */
  async collectMedia(m) {
    const images = [];
    const notes = [];
    const maxImageBytes = cfgNum(this.cfg, 'maxImageBytes', MAX_IMAGE_BYTES, 1048576, 20971520);
    const maxImages = cfgNum(this.cfg, 'maxImages', MAX_IMAGES, 1, 10);
    for (const a of m.attachments ?? []) {
      const type = String(a?.contentType ?? '');
      if (type === 'text/html' || type === 'text/plain') continue; // the body's own echo
      if (type.startsWith('image/') && typeof a.contentUrl === 'string') {
        if (images.length >= maxImages) continue;
        try {
          const buf = await this.connector.download(a.contentUrl, maxImageBytes);
          images.push({ data: buf.toString('base64'), mimeType: type });
        } catch (e) {
          notes.push('[Attachment: image (download failed or too large)]');
          this.log.error(`image download failed: ${e?.message ?? e}`);
        }
      } else if (a?.name) {
        notes.push(`[Attachment: ${a.name} (${type || 'unknown'})]`);
      }
    }
    return { images, notes };
  }

  // ── outbound (host-initiated) ──

  /** Host `send` (bound-session output): strip the /new generation suffix and post to the stored ref. */
  async send(channelId, text) {
    const conversationId = String(channelId).replace(/#\d+$/, '');
    const ref = this.state.get(conversationId).ref;
    if (!ref?.serviceUrl) { this.log.warn(`msteams send: no stored route for conversation ${conversationId}`); return; }
    for (const piece of splitContent(String(text))) {
      await this.connector.send(ref.serviceUrl, conversationId, { type: 'message', textFormat: 'markdown', text: piece });
    }
  }

  /** Whether any sender id maps to an admin policy — the gate shared pickers/tools will use. */
  isAdmin(ids) {
    return senderIsAdmin(ids, this.cfg.rolePolicies);
  }
}
