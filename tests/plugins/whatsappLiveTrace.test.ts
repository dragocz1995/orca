import { describe, it, expect } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The WhatsApp live progress bubble used to be a stripped-down copy of the Discord/Telegram trace: it
 *  rendered only the tool CALL line (name/detail/×N) and silently dropped tool results, diffs, sub-agent
 *  panels and retry/compaction notices. These tests drive the shared render/fold engine through WhatsApp's
 *  LiveMessage and assert those surfaces now reach the pane (regression guard for the drift). */
describe('whatsapp LiveMessage (live tool trace)', () => {
  const load = async () => (await import(join(repoRoot, 'plugins/whatsapp/lib/stream.mjs'))) as {
    LiveMessage: new (
      adapter: unknown, jid: string, quoted?: unknown, asker?: string,
    ) => {
      onEvent: (e: Record<string, unknown>) => void;
      finalize: (reply?: string) => Promise<void>;
    };
  };

  /** A fake Baileys adapter: `sock.sendMessage` records the latest progress-bubble text (create + every
   *  edit overwrite the same buffer), and the final answer lands via `sendText`. */
  function fakeAdapter() {
    const state = { progress: '', answers: [] as string[] };
    const adapter = {
      cfg: { runtimeFooter: false },
      sock: {
        sendMessage: async (_jid: string, msg: { text: string; edit?: unknown }) => {
          state.progress = msg.text;
          return { key: msg.edit ?? { id: 'k1' } };
        },
      },
      resolveImageFiles: () => [],
      sendImages: async () => {},
      sendText: async (_jid: string, body: string) => { state.answers.push(body); },
      postAsk: async () => {},
    };
    return { adapter, state };
  }

  it('surfaces a settled tool RESULT summary (not just the call line)', async () => {
    const { LiveMessage } = await load();
    const { adapter, state } = fakeAdapter();
    const lm = new LiveMessage(adapter, 'jid@s');
    lm.onEvent({ type: 'tool', id: 'a', name: 'Bash', detail: 'npm test', icon: '💻' });
    lm.onEvent({ type: 'tool_output', id: 'a', output: { title: 'console', kind: 'console', text: '44 tests passed', status: 'exit 0', tone: 'success' } });
    await lm.finalize('Done.');
    expect(state.progress).toContain('Bash');
    expect(state.progress).toContain('44 tests passed'); // the RESULT summary — dropped before the fix
  });

  it('surfaces a file EDIT as a diff summary', async () => {
    const { LiveMessage } = await load();
    const { adapter, state } = fakeAdapter();
    const lm = new LiveMessage(adapter, 'jid@s');
    lm.onEvent({ type: 'tool', id: 'b', name: 'Edit', detail: 'app.ts', icon: '✏️' });
    lm.onEvent({ type: 'diff', id: 'b', diff: '--- a\n+++ b\n+one\n+two\n+three\n-old' });
    await lm.finalize('Patched.');
    expect(state.progress).toMatch(/\+3/);   // three added lines
    expect(state.progress).toMatch(/[-−]1/); // one removed line
  });

  it('surfaces a sub-agent panel and a retry notice', async () => {
    const { LiveMessage } = await load();
    const { adapter, state } = fakeAdapter();
    const lm = new LiveMessage(adapter, 'jid@s') as unknown as {
      onEvent: (e: Record<string, unknown>) => void;
      finalize: (r?: string) => Promise<void>;
      progress: { lastEdit: number; flush: () => Promise<void> } | null;
    };
    lm.onEvent({ type: 'tool', id: 'c', name: 'Delegate', detail: 'explore the repo', icon: '🤝' });
    lm.onEvent({ type: 'subagent', id: 'c', status: 'done', tools: 5, seconds: 12, task: 'explore the repo' });
    lm.onEvent({ type: 'notice', kind: 'retry', message: 'rate limited — retrying (2/5)' });
    // A retry/compaction notice is transient — it is cleared at finalize by design (like Discord), so
    // assert it reached the LIVE bubble mid-stream (force past the edit throttle to inspect deterministically).
    if (lm.progress) { lm.progress.lastEdit = 0; await lm.progress.flush(); }
    expect(state.progress).toContain('rate limited'); // retry notice — dropped entirely before the fix
    await lm.finalize('Explored.');
    expect(state.progress).toContain('5 tools · 12s'); // the sub-agent summary persists on the settled row
  });

  it('folds a run of the SAME failure into one counted row', async () => {
    const { LiveMessage } = await load();
    const { adapter, state } = fakeAdapter();
    const lm = new LiveMessage(adapter, 'jid@s');
    for (const path of ['a.ts', 'b.ts', 'c.ts']) {
      const id = `r-${path}`;
      lm.onEvent({ type: 'tool', id, name: 'Read', detail: path, icon: '📄' });
      lm.onEvent({ type: 'tool_output', id, output: { title: 'error', kind: 'console', text: `ENOENT ${path}`, status: 'missing', tone: 'danger' } });
    }
    await lm.finalize('Missing.');
    expect(state.progress).toMatch(/×3/); // three same-signature failures collapse to one ×3 row
  });
});
