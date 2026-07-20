#!/usr/bin/env node
// Core chat-turn E2E scenario against a REAL built daemon.
//
// Proves the real wiring end to end: authenticate → start a brain conversation → open the real SSE stream
// → send a message → the daemon calls the scripted OpenAI-compatible model server over real HTTP → the
// streamed text deltas arrive over real SSE and ACCUMULATE → a real tool call (ElowenListMissions, a safe
// read-only owner tool) executes → the turn reaches idle → GET /brain/messages persists the turn and it
// reloads with the tool call. Then flips the model server to error mode to prove the scenario fails loudly.
//
// No sleep-based waits on the turn: every wait is on a stream frame or /health with a hard deadline.
// Run with: npm run test:e2e:brain

import { startModelServer } from './model-server.mjs';
import { spawnRealDaemon } from './spawn-daemon.mjs';

const TOOL_NAME = 'ElowenListMissions';
const FINAL_MARKER = 'E2E-BRAIN-DONE';
const FIRST_MARKER = 'Let me check the Elowen missions';

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

/** Open a real SSE stream against `${baseUrl}${path}` and expose the parsed brain events plus a
 *  deadline-bounded `waitFor`. Parses standard `event:`/`data:` frames; ignores `:` comment lines. */
async function openStream(baseUrl, path, token) {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  if (!res.ok || !res.body) throw new Error(`stream open failed: HTTP ${res.status}`);

  const events = [];
  const waiters = [];
  const notify = () => {
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].predicate(events)) { waiters[i].resolve(events); waiters.splice(i, 1); }
    }
  };

  (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let dataLine = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          try { events.push(JSON.parse(dataLine)); notify(); } catch { /* non-JSON frame */ }
        }
      }
    } catch { /* stream aborted on close */ }
  })();

  return {
    events,
    waitFor(predicate, timeoutMs, label) {
      if (predicate(events)) return Promise.resolve(events);
      return new Promise((resolve, reject) => {
        const entry = { predicate, resolve };
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(entry);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(new Error(`timed out after ${timeoutMs}ms waiting for: ${label}\nevents so far: ${events.map((e) => e.type).join(', ')}`));
        }, timeoutMs);
        entry.resolve = (v) => { clearTimeout(timer); resolve(v); };
        waiters.push(entry);
      });
    },
    close() { controller.abort(); },
  };
}

async function post(baseUrl, path, token, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
  return { status: res.status, json, text };
}

async function getJson(baseUrl, path, token) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const model = await startModelServer({ toolName: TOOL_NAME });
  let daemon = null;
  try {
    daemon = await spawnRealDaemon({ providerBaseUrl: model.baseUrl });
    const { baseUrl, token } = daemon;
    console.log(`daemon up on ${baseUrl}; model server on ${model.baseUrl}`);

    // 1) Start a fresh brain conversation.
    const start = await post(baseUrl, '/brain/start', token, { fresh: true });
    assert(start.status === 201, `POST /brain/start → 201 (got ${start.status}: ${start.text})`);
    const sessionId = start.json?.sessionId;
    assert(typeof sessionId === 'string' && sessionId, 'start returned a sessionId');

    // 2) Open the REAL SSE stream bound to that session BEFORE sending, so no event is missed.
    const stream = await openStream(baseUrl, `/brain/stream?session=${encodeURIComponent(sessionId)}`, token);
    await stream.waitFor(() => true, 5_000, 'stream connected').catch(() => {});
    await new Promise((r) => setTimeout(r, 200)); // let the session tap attach before the send

    // 3) Send a message → the turn runs and streams over the open SSE.
    const sendText = 'List the current Elowen missions.';
    const send = await post(baseUrl, '/brain/send', token, { text: sendText, session: sessionId, mode: 'build' });
    assert(send.status === 202, `POST /brain/send → 202 accepted (got ${send.status}: ${send.text})`);

    // 4) The turn reaches idle. Wait on the frame, not a timer.
    await stream.waitFor((evs) => evs.some((e) => e.type === 'idle'), 45_000, 'idle');

    // --- Assert streamed TEXT deltas arrived and ACCUMULATE (not replace) ---
    const textEvents = stream.events.filter((e) => e.type === 'text');
    assert(textEvents.length >= 2, `at least 2 streamed text deltas (accumulate), got ${textEvents.length}`);
    const streamedText = textEvents.map((e) => e.delta).join('');
    assert(streamedText.includes(FIRST_MARKER), `streamed text includes the pre-tool marker: got "${streamedText}"`);
    assert(streamedText.includes(FINAL_MARKER), `streamed text includes the final marker: got "${streamedText}"`);

    // --- Assert the tool call actually ran over the real daemon ---
    const toolEvents = stream.events.filter((e) => e.type === 'tool');
    assert(toolEvents.some((e) => e.name === TOOL_NAME), `a '${TOOL_NAME}' tool event streamed; tools: ${toolEvents.map((e) => e.name).join(', ') || '(none)'}`);

    // --- Assert the model server actually served two requests (turn + post-tool follow-up) ---
    assert(model.requests.length >= 2, `model server served the tool round-trip (>=2 requests), got ${model.requests.length}`);
    const secondReq = model.requests[1];
    assert(Array.isArray(secondReq?.body?.messages) && secondReq.body.messages.some((m) => m.role === 'tool'),
      'the follow-up model request carried the tool result');

    // 5) Persistence: GET /brain/messages reloads the turn WITH the tool call.
    const messages = await getJson(baseUrl, `/brain/messages?session=${encodeURIComponent(sessionId)}`, token);
    assert(Array.isArray(messages), 'GET /brain/messages returned an array');
    const userMsg = messages.find((m) => m.role === 'user' && typeof m.text === 'string' && m.text.includes(sendText));
    assert(userMsg, 'persisted transcript contains the user turn');
    const toolMsg = messages.find((m) => m.role === 'assistant' && Array.isArray(m.segments)
      && m.segments.some((s) => s.kind === 'tool' && s.name === TOOL_NAME));
    assert(toolMsg, `persisted transcript reloads with the '${TOOL_NAME}' tool call`);
    // The tool round-trip persists two assistant rows (the tool-call turn, then the final reply); the
    // final marker lives on whichever assistant turn carried the closing text.
    const finalMsg = messages.find((m) => m.role === 'assistant' && typeof m.text === 'string' && m.text.includes(FINAL_MARKER));
    assert(finalMsg, 'persisted transcript includes the final reply text');

    console.log('PASS core chat-turn: SSE deltas accumulated, tool ran, turn idled, transcript persisted.');

    // 6) TEETH: flip the model server to error mode and prove a mis-wired/failed model fails loudly.
    model.setFail(true);
    const teeth = await openStream(baseUrl, `/brain/stream?session=${encodeURIComponent(sessionId)}`, token);
    await new Promise((r) => setTimeout(r, 200));
    const send2 = await post(baseUrl, '/brain/send', token, { text: 'This turn must fail.', session: sessionId, mode: 'build' });
    assert(send2.status === 202, `second send accepted (got ${send2.status})`);
    await teeth.waitFor((evs) => evs.some((e) => e.type === 'error'), 45_000, 'error event on provider failure');
    console.log('PASS teeth: an injected provider error surfaced as a streamed brain error event.');

    stream.close();
    teeth.close();
  } finally {
    if (daemon) await daemon.stop();
    await model.close();
  }
}

main().then(() => {
  console.log('PASS test:e2e:brain — real daemon brain chat turn verified.');
  process.exit(0);
}).catch((err) => {
  console.error(`FAIL test:e2e:brain — ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
