import { describe, it, expect, vi } from 'vitest';
import { DecisionQueue } from '../../src/overseer/decisionQueue.js';

describe('DecisionQueue', () => {
  it('next() resolves with an enqueued request, and enqueue() resolves when decided', async () => {
    const q = new DecisionQueue();
    const verdict = q.enqueue('m1', 'task', { title: 'x' }, false);
    const req = await q.next('m1');
    expect(req).not.toBeNull();
    expect(req!.kind).toBe('task');
    expect(req!.context).toEqual({ title: 'x' });
    expect(q.resolve('m1', req!.id, { approve: true, confidence: 0.9, destructive: false, rationale: 'ok' })).toBe(true);
    await expect(verdict).resolves.toMatchObject({ approve: true, confidence: 0.9 });
  });

  it('a waiting next() wakes when a request is enqueued later', async () => {
    const q = new DecisionQueue();
    const waiting = q.next('m2', 1000);
    q.enqueue('m2', 'prompt', { q: '?' }, false);
    const req = await waiting;
    expect(req!.kind).toBe('prompt');
  });

  it('next() returns null (heartbeat) after its timeout with nothing pending', async () => {
    vi.useFakeTimers();
    const q = new DecisionQueue();
    const p = q.next('m3', 25000);
    await vi.advanceTimersByTimeAsync(25000);
    await expect(p).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('enqueue() resolves to an escalate-to-human verdict on timeout (never auto-decides)', async () => {
    vi.useFakeTimers();
    const q = new DecisionQueue();
    const verdict = q.enqueue('m4', 'task', {}, true, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    // `escalated: true` flags "no overseer verdict — hand to a human"; consumers must NOT treat this
    // like a real reject (e.g. an L3 review must not self-heal/re-run on it).
    await expect(verdict).resolves.toEqual({ approve: false, confidence: 0, destructive: true, rationale: 'overseer timeout', escalated: true });
    vi.useRealTimers();
  });

  it('resolve() keeps the local destructive flag even when the agent approves (authoritative)', async () => {
    const q = new DecisionQueue();
    const verdict = q.enqueue('m6', 'task', { title: 'rm -rf' }, true); // local heuristic: destructive
    const req = await q.next('m6');
    // Agent answers approve + destructive:false — must NOT override the local flag.
    q.resolve('m6', req!.id, { approve: true, confidence: 0.9, destructive: false, rationale: 'looks fine' });
    await expect(verdict).resolves.toMatchObject({ approve: true, destructive: true });
  });

  it('carries the overseer-picked choice through a question verdict', async () => {
    const q = new DecisionQueue();
    const verdict = q.enqueue('mq', 'question', { question: 'which port?', options: [{ id: '1', label: 'a' }, { id: '2', label: 'b' }] }, false);
    const req = await q.next('mq');
    expect(req!.kind).toBe('question');
    q.resolve('mq', req!.id, { approve: false, confidence: 0.9, destructive: false, rationale: 'docs-only', choice: '2' });
    await expect(verdict).resolves.toMatchObject({ choice: '2', confidence: 0.9 });
  });

  it('a question that times out carries no choice (⇒ the deriver escalates)', async () => {
    vi.useFakeTimers();
    const q = new DecisionQueue();
    const verdict = q.enqueue('mqt', 'question', { question: '?' }, false, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    const v = await verdict;
    expect(v.choice).toBeUndefined();
    vi.useRealTimers();
  });

  it('drain() escalates all pending for a mission', async () => {
    const q = new DecisionQueue();
    const a = q.enqueue('m5', 'task', {}, false);
    q.drain('m5');
    await expect(a).resolves.toMatchObject({ approve: false, rationale: 'mission disengaged' });
  });
});
