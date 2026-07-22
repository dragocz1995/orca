import { describe, it, expect } from 'vitest';
import {
  CLEAR_MIN_BYTES,
  applyToolResultClearing,
  cacheColdAtTurnStart,
  clearedToolResultPlaceholder,
  clearingCutIndex,
  idleThresholdMs,
  installToolResultClearing,
  selectClearableToolResults,
  toolResultSpillPath,
} from '../../../src/brain/session/toolResultClearing.js';
import type { PiAgentMessage } from '../../../src/brain/session/historyImageStripping.js';

const T0 = 1_000_000;
const IDLE = 60_000;

const user = (text: string, timestamp: number): PiAgentMessage =>
  ({ role: 'user', content: [{ type: 'text', text }], timestamp });

const assistant = (text: string, timestamp: number): PiAgentMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'anthropic-messages', provider: 'anthropic', model: 'test-model',
  usage: {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop', timestamp,
});

const toolResult = (toolCallId: string, text: string, timestamp: number): PiAgentMessage => ({
  role: 'toolResult', toolCallId, toolName: 'Bash',
  content: [{ type: 'text', text }], isError: false, timestamp,
});

const big = 'x'.repeat(CLEAR_MIN_BYTES + 100);
const small = 'y'.repeat(100);

interface Harness {
  session: { agent: { transformContext?: (m: PiAgentMessage[], s?: AbortSignal) => Promise<PiAgentMessage[]> } };
  transform: (m: PiAgentMessage[]) => Promise<PiAgentMessage[]>;
  writes: Map<string, string>;
}

function harness(options: { idleMs?: number; writeSpill?: (p: string, t: string) => Promise<void> } = {}): Harness {
  const writes = new Map<string, string>();
  const session: Harness['session'] = { agent: {} };
  installToolResultClearing(session, 'sess-1', {
    idleMs: options.idleMs ?? IDLE,
    spillDir: '/tmp/spill/sess-1',
    writeSpill: options.writeSpill ?? (async (p, t) => { writes.set(p, t); }),
  });
  return { session, writes, transform: (m) => session.agent.transformContext!(m) };
}

describe('selectClearableToolResults / clearingCutIndex', () => {
  it('keeps the current and previous user turns, selects only large older results with an id', () => {
    const messages: PiAgentMessage[] = [
      user('one', T0),
      toolResult('old-big', big, T0 + 1),
      toolResult('old-small', small, T0 + 2),
      { role: 'toolResult', toolCallId: '', toolName: 'Bash', content: [{ type: 'text', text: big }], isError: false, timestamp: T0 + 3 } as PiAgentMessage,
      assistant('done', T0 + 4),
      user('two', T0 + 5),
      toolResult('prev-turn-big', big, T0 + 6),
      assistant('done', T0 + 7),
      user('three', T0 + 8),
      toolResult('current-big', big, T0 + 9),
    ];
    const cut = clearingCutIndex(messages);
    expect(messages[cut]).toBe(messages[5]); // the 'two' user message starts the previous turn
    const selected = selectClearableToolResults(messages, new Set());
    expect(selected.map((s) => s.toolCallId)).toEqual(['old-big']);
    expect(selected[0]?.bytes).toBe(big.length);
  });

  it('selects nothing when the conversation has fewer than two user messages', () => {
    const messages: PiAgentMessage[] = [user('one', T0), toolResult('big-1', big, T0 + 1)];
    expect(clearingCutIndex(messages)).toBe(-1);
    expect(selectClearableToolResults(messages, new Set())).toEqual([]);
  });

  it('skips already-latched ids', () => {
    const messages: PiAgentMessage[] = [
      user('one', T0), toolResult('old-big', big, T0 + 1), user('two', T0 + 2), user('three', T0 + 3),
    ];
    expect(selectClearableToolResults(messages, new Set(['old-big']))).toEqual([]);
  });
});

describe('cacheColdAtTurnStart', () => {
  it('is false while the conversation is active and true after an idle gap', () => {
    const active: PiAgentMessage[] = [user('one', T0), assistant('a', T0 + 1_000), user('two', T0 + 5_000)];
    expect(cacheColdAtTurnStart(active, IDLE, T0 + 5_000)).toBe(false);
    const idle: PiAgentMessage[] = [user('one', T0), assistant('a', T0 + 1_000), user('two', T0 + IDLE + 2_000)];
    expect(cacheColdAtTurnStart(idle, IDLE, T0 + IDLE + 2_000)).toBe(true);
  });

  it('is false for the very first user message (nothing to compare against)', () => {
    expect(cacheColdAtTurnStart([user('one', T0)], IDLE, T0)).toBe(false);
  });
});

describe('applyToolResultClearing', () => {
  it('replaces content with the placeholder, never mutates input, is idempotent', () => {
    const messages: PiAgentMessage[] = [
      user('one', T0), toolResult('old-big', big, T0 + 1), user('two', T0 + 2), user('three', T0 + 3),
    ];
    const snapshot = structuredClone(messages);
    const placeholder = clearedToolResultPlaceholder(toolResultSpillPath('/tmp/spill/sess-1', 'old-big'), big.length);
    const once = applyToolResultClearing(messages, new Map([['old-big', { index: 1, placeholder }]]));
    expect(messages).toEqual(snapshot);
    expect(once[1]).toEqual({ ...messages[1], content: [{ type: 'text', text: placeholder }] });
    expect(once[0]).toBe(messages[0]);
    expect(applyToolResultClearing(once, new Map([['old-big', { index: 1, placeholder }]]))).toBe(once);
  });
});

describe('installToolResultClearing', () => {
  it('does nothing while the conversation stays active', async () => {
    const h = harness();
    const messages: PiAgentMessage[] = [
      user('one', T0), toolResult('old-big', big, T0 + 1_000),
      user('two', T0 + 2_000), toolResult('prev-big', big, T0 + 3_000),
      user('three', T0 + 4_000),
    ];
    const result = await h.transform(messages);
    expect(result).toEqual(messages);
    expect(h.writes.size).toBe(0);
  });

  it('clears large old results after an idle gap, spills full text first, keeps recent turns', async () => {
    const h = harness();
    const messages: PiAgentMessage[] = [
      user('one', T0), toolResult('old-big', big, T0 + 1_000), toolResult('old-small', small, T0 + 2_000),
      user('two', T0 + 3_000), toolResult('prev-big', big, T0 + 4_000),
      user('three', T0 + IDLE + 5_000),
    ];
    const result = await h.transform(messages);
    const path = toolResultSpillPath('/tmp/spill/sess-1', 'old-big');
    expect(h.writes.get(path)).toBe(big);
    expect(result[1]).toEqual({
      ...messages[1],
      content: [{ type: 'text', text: clearedToolResultPlaceholder(path, big.length) }],
    });
    // Small results and the two trailing turns are untouched.
    expect(result[2]).toBe(messages[2]);
    expect(result[4]).toBe(messages[4]);
  });

  it('latch keeps a cleared result cleared forever, with a byte-identical placeholder', async () => {
    const h = harness();
    const turn3: PiAgentMessage[] = [
      user('one', T0), toolResult('old-big', big, T0 + 1_000),
      user('two', T0 + 2_000),
      user('three', T0 + IDLE + 3_000),
    ];
    const clearedOnce = await h.transform(turn3);
    // The conversation continues actively (small gaps — gate closed): the placeholder must persist.
    const turn4: PiAgentMessage[] = [...turn3, assistant('ok', T0 + IDLE + 4_000), user('four', T0 + IDLE + 5_000)];
    const clearedTwice = await h.transform(turn4);
    expect(clearedTwice[1]).toEqual(clearedOnce[1]);
    const text1 = JSON.stringify(clearedOnce[1]);
    const text2 = JSON.stringify(clearedTwice[1]);
    expect(text2).toBe(text1);
  });

  it('prefix stability: a warm pass never rewrites anything, a cold pass only appends clearings', async () => {
    const h = harness();
    // Turns 1–3 active: outputs must be byte-identical to inputs every single pass.
    const turns: PiAgentMessage[][] = [
      [user('one', T0), toolResult('r1', big, T0 + 1_000)],
      [user('one', T0), toolResult('r1', big, T0 + 1_000), assistant('a1', T0 + 2_000), user('two', T0 + 3_000)],
      [user('one', T0), toolResult('r1', big, T0 + 1_000), assistant('a1', T0 + 2_000), user('two', T0 + 3_000), toolResult('r2', big, T0 + 4_000)],
    ];
    for (const turn of turns) {
      expect(JSON.stringify(await h.transform(turn))).toBe(JSON.stringify(turn));
    }
    // Idle gap, then turn 4: everything before the previous user turn is now cleared, but every pass
    // AFTER that must reproduce the cleared bytes exactly.
    const turn4: PiAgentMessage[] = [...turns[2], user('three', T0 + IDLE + 5_000)];
    const cleared4 = await h.transform(turn4);
    expect(JSON.stringify(cleared4[1])).toContain('Older tool result cleared');
    const turn5: PiAgentMessage[] = [...turn4, assistant('a3', T0 + IDLE + 6_000), user('four', T0 + IDLE + 7_000)];
    const cleared5 = await h.transform(turn5);
    // The shared prefix (turn4's whole array) is byte-identical between the two passes.
    expect(JSON.stringify(cleared5.slice(0, cleared4.length))).toBe(JSON.stringify(cleared4));
  });

  it('does not clear when the spill write fails (and retries on the next pass)', async () => {
    let calls = 0;
    const h = harness({
      writeSpill: async () => { calls += 1; throw Object.assign(new Error('readonly'), { code: 'EACCES' }); },
    });
    const messages: PiAgentMessage[] = [
      user('one', T0), toolResult('old-big', big, T0 + 1_000),
      user('two', T0 + 2_000),
      user('three', T0 + IDLE + 3_000),
    ];
    const first = await h.transform(messages);
    expect(JSON.stringify(first[1])).toContain('xxxx'); // still full content
    expect(calls).toBe(1);
    await h.transform(messages); // not latched → retried
    expect(calls).toBe(2);
  });

  it('treats EEXIST as success: a pre-respawn spill on disk is good enough to clear', async () => {
    const h = harness({
      writeSpill: async () => { throw Object.assign(new Error('exists'), { code: 'EEXIST' }); },
    });
    const messages: PiAgentMessage[] = [
      user('one', T0), toolResult('old-big', big, T0 + 1_000),
      user('two', T0 + 2_000),
      user('three', T0 + IDLE + 3_000),
    ];
    const result = await h.transform(messages);
    expect(JSON.stringify(result[1])).toContain('Older tool result cleared');
  });

  it('composes with a pre-existing transformContext and survives a missing agent seam', async () => {
    const calls: string[] = [];
    const session = {
      agent: {
        transformContext: async (m: PiAgentMessage[]): Promise<PiAgentMessage[]> => { calls.push('previous'); return m; },
      },
    };
    installToolResultClearing(session, 'sess-1', { idleMs: IDLE, writeSpill: async () => undefined });
    const messages: PiAgentMessage[] = [
      user('one', T0), toolResult('old-big', big, T0 + 1_000), user('two', T0 + 2_000), user('three', T0 + IDLE + 3_000),
    ];
    const result = await session.agent.transformContext!(messages);
    expect(calls).toEqual(['previous']);
    expect(JSON.stringify(result[1])).toContain('Older tool result cleared');
    expect(() => installToolResultClearing({}, 'sess-1')).not.toThrow();
  });
});

describe('idleThresholdMs', () => {
  it('tracks the cache TTL: 61 minutes for long retention, 6 otherwise', () => {
    expect(idleThresholdMs({ PI_CACHE_RETENTION: 'long' } as NodeJS.ProcessEnv)).toBe(61 * 60_000);
    expect(idleThresholdMs({} as NodeJS.ProcessEnv)).toBe(6 * 60_000);
  });
});
