// Scripted OpenAI-compatible model server for the Delegate / Workflow sub-agent E2E suite.
//
// Same philosophy as scripts/tests/brain-e2e/model-server.mjs (fake ONLY the nondeterministic model,
// serve `POST /v1/chat/completions` as a deterministic SSE stream) — but this variant must serve MORE
// than one distinct scripted response per instance, because one delegation drives THREE model turns
// against the SAME server:
//   1. PARENT first turn (no tool result yet)          → emit the delegate/workflow tool_call
//   2. CHILD / workflow-node turn(s) (fresh session)   → answer directly with a unique marker
//   3. PARENT follow-up turn (the tool result is back) → final answer that incorporates the child result
//
// The parent-first turn and a child turn BOTH arrive with no `tool` role message, so `hasToolResult`
// alone cannot tell them apart. We discriminate on message CONTENT: a child turn is the one whose
// messages carry the delegated task marker (the host passes the task text as the child's user message,
// and the sub-agent role prompt as its system prompt). This is also exactly the surface the test
// asserts on — the child ran with the RIGHT task and the host's distinct sub-agent system prompt.
//
// Kept in this suite's own dir (not an edit to the shared brain-e2e server) so nothing about the
// existing brain-e2e behaviour can change.

import { createServer } from 'node:http';

/** Flatten an OpenAI message `content` (string | array of parts | null) into plain text for matching. */
function contentText(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((part) => (typeof part?.text === 'string' ? part.text : '')).join(' ');
  return '';
}

/** Read and JSON-parse a request body; tolerate an empty/garbage body (returns null). */
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function chunkFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Start the scripted model server on an ephemeral loopback port.
 *
 * @param {object} opts
 * @param {string} opts.toolName        Tool the PARENT calls on its first turn (Delegate / WorkflowStart).
 * @param {string} opts.toolArgs        JSON string of that tool's arguments (must carry the child task marker).
 * @param {string} [opts.parentFirstText] Text streamed before the parent's tool call.
 * @param {string} opts.parentFinalText  Text streamed on the parent's post-tool follow-up turn.
 * @param {Array<{ match: string, text: string }>} opts.children
 *        For a no-tool-result request whose messages contain `match`, answer with `text` (finish `stop`)
 *        instead of calling a tool. This is how a CHILD / workflow-node turn is served. Order matters only
 *        if a request could match several — in practice each child turn carries exactly one marker.
 * @returns {Promise<{ baseUrl, port, requests, contentText, setFail, close }>}
 */
export async function startScriptedModelServer(opts) {
  if (!opts?.toolName) throw new Error('startScriptedModelServer requires a toolName');
  const toolName = opts.toolName;
  const toolArgs = opts.toolArgs ?? '{}';
  const parentFirstText = opts.parentFirstText ?? 'Delegating this to a sub-agent. ';
  const parentFinalText = opts.parentFinalText ?? 'The sub-agent finished.';
  const children = Array.isArray(opts.children) ? opts.children : [];

  const requests = [];
  let fail = false;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const body = await readJson(req);
    requests.push({ method: req.method, path: url.pathname, body });

    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `unhandled ${req.method} ${url.pathname}` }));
      return;
    }
    if (fail) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'E2E injected provider failure', type: 'server_error' } }));
      return;
    }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const hasToolResult = messages.some((m) => m && m.role === 'tool');
    const allText = messages.map(contentText).join('\n');

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    const base = { id: 'chatcmpl-e2e', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model' };
    const delta = (d, finish = null) => chunkFrame({ ...base, choices: [{ index: 0, delta: d, finish_reason: finish }] });
    const usage = (p, comp) => chunkFrame({ ...base, choices: [], usage: { prompt_tokens: p, completion_tokens: comp, total_tokens: p + comp } });

    // A child / workflow-node turn: no tool result AND the messages carry a child task marker. Answer
    // directly, no tool call — the host returns this text to the parent as the tool result.
    const child = !hasToolResult ? children.find((c) => allText.includes(c.match)) : undefined;

    if (hasToolResult) {
      // Parent follow-up: the delegate/workflow tool result (the child's answer) is now in context.
      res.write(delta({ role: 'assistant', content: parentFinalText }));
      res.write(delta({}, 'stop'));
      res.write(usage(200, 20));
    } else if (child) {
      res.write(delta({ role: 'assistant', content: child.text }));
      res.write(delta({}, 'stop'));
      res.write(usage(90, 12));
    } else {
      // Parent first turn: stream a little text, then the single tool call the daemon actually executes.
      res.write(delta({ role: 'assistant', content: parentFirstText }));
      res.write(delta({ tool_calls: [{ index: 0, id: 'call_e2e_parent', type: 'function', function: { name: toolName, arguments: toolArgs } }] }));
      res.write(delta({}, 'tool_calls'));
      res.write(usage(120, 18));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('model server did not bind a TCP port');

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    port: address.port,
    requests,
    contentText,
    setFail: (v) => { fail = !!v; },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
