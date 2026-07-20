// A fake in-process Baileys socket + HTTP bridge for the WhatsApp-adapter E2E suite.
//
// Baileys talks to WhatsApp over an ENCRYPTED Noise-protocol WebSocket with Signal E2E encryption and
// QR/multi-device pairing — there is no wire to fake without reimplementing Signal. So instead of faking
// the wire (as fake-telegram/fake-discord do for their plain HTTP/WS transports), this module is loaded
// INSIDE the daemon via the adapter's `WHATSAPP_E2E_SOCKET_MODULE` seam and hands the adapter a fake
// "already connected" socket. The adapter's REAL inbound pipeline (onUpsert → onMessage → the brain) and
// outbound path (sendMessage/sendPresenceUpdate/react/edit) then run unchanged, with pairing/auth skipped.
//
// The adapter runs in the daemon child process, so a tiny HTTP bridge (bound to WHATSAPP_E2E_BRIDGE_PORT)
// lets the out-of-process test runner (a) inject scripted inbound messages and (b) read every captured
// outbound socket call. This mirrors the "fake server binds a loopback port, the runner polls it" shape.
//
// SAFETY: binds an ephemeral loopback port supplied by the runner (never 4400/4500); no network egress.
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';

const BOT_JID = process.env.WHATSAPP_E2E_BOT_JID || '10000000001@s.whatsapp.net';

const calls = [];     // every captured outbound socket call, JSON-safe, in order
let currentEv = null; // the EventEmitter of the most recently created fake socket (inbound target)
let seq = 0;

const record = (entry) => { calls.push({ ...entry, at: Date.now() }); };

/** Project a Baileys sendMessage content union into a JSON-safe shape the runner can assert on. */
function projectContent(content) {
  if (!content || typeof content !== 'object') return { kind: 'unknown' };
  if (typeof content.text === 'string') return { kind: content.edit ? 'edit' : 'text', text: content.text };
  if (content.react) return { kind: 'react', react: content.react.text ?? '' };
  if (content.image) return { kind: 'image' };
  return { kind: 'other' };
}

/**
 * The adapter's `makeWASocket` replacement: a minimal fake socket implementing exactly the surface the
 * WhatsApp adapter touches. Emits `connection.update {connection:'open'}` on the next tick (after the
 * adapter has synchronously attached its listeners) so the adapter marks itself connected without pairing.
 */
export function createFakeSocket(_options) {
  const ev = new EventEmitter();
  ev.setMaxListeners(50);
  currentEv = ev;

  const sock = {
    ev,
    user: { id: BOT_JID }, // read on 'open' → the adapter's meId
    async sendMessage(jid, content, options) {
      record({ method: 'sendMessage', jid, ...projectContent(content), quoted: !!options?.quoted });
      const id = `BAE5${(seq += 1)}`;
      const message = typeof content?.text === 'string' ? { conversation: content.text } : {};
      return { key: { id, remoteJid: jid, fromMe: true }, message }; // shape the adapter caches in sentStore
    },
    async sendPresenceUpdate(presence, jid) { record({ method: 'sendPresenceUpdate', presence, jid }); },
    async readMessages() { /* no-op */ },
    async groupMetadata(jid) { return { id: jid, subject: 'E2E Group' }; },
    async logout() { record({ method: 'logout' }); },
    async requestPairingCode() { return '00000000'; }, // never hit (no phoneNumber configured)
    updateMediaMessage: async (m) => m,
    end() { record({ method: 'end' }); },
  };

  // Attach happens synchronously in startSocket right after this returns, so defer the 'open' by a tick.
  setTimeout(() => ev.emit('connection.update', { connection: 'open' }), 0);
  return sock;
}

/** Emit a scripted inbound private/group text as a Baileys 'notify' upsert on the live socket. */
function inject({ jid, text, pushName }) {
  if (!currentEv) return false;
  const message = {
    key: { remoteJid: jid, fromMe: false, id: `IN${(seq += 1)}` },
    message: { conversation: text },
    pushName: pushName ?? 'Tester',
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
  currentEv.emit('messages.upsert', { type: 'notify', messages: [message] });
  return true;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// The HTTP bridge the out-of-process runner drives. Bound once, on module load, inside the daemon child.
const bridgePort = Number(process.env.WHATSAPP_E2E_BRIDGE_PORT || 0);
if (bridgePort) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, connected: !!currentEv });
    if (req.method === 'GET' && url.pathname === '/calls') return json(200, { calls });
    if (req.method === 'POST' && url.pathname === '/inject') {
      const body = await readJson(req);
      const delivered = inject(body);
      return json(delivered ? 200 : 409, { delivered });
    }
    return json(404, { error: `unhandled ${req.method} ${url.pathname}` });
  });
  server.on('error', (e) => { console.error(`whatsapp-e2e bridge failed: ${e?.message ?? e}`); });
  server.listen(bridgePort, '127.0.0.1');
  server.unref?.(); // never keep the daemon alive on the bridge's account
}
