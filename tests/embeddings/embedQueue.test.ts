import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { MemoryStore, hashBody } from '../../src/store/memoryStore.js';
import { EmbeddingQueue, type Embedder } from '../../src/embeddings/embedQueue.js';
import type { EmbeddingConfig } from '../../src/embeddings/embeddingService.js';

const CFG: EmbeddingConfig = { providerId: 'openai', model: 'text-embedding-3-small' };

/** A fake embedder recording every body it was asked to embed and returning a fixed-width vector. */
function fakeEmbedder(dimensions = 4): Embedder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async embed(_cfg: EmbeddingConfig, text: string): Promise<Float32Array> {
      calls.push(text);
      return Float32Array.from(Array.from({ length: dimensions }, (_v, i) => i + text.length));
    },
  };
}

/** A roster of the given user ids. */
const roster = (...ids: number[]) => ({ list: () => ids.map((id) => ({ id })) });

describe('EmbeddingQueue', () => {
  let store: MemoryStore;
  beforeEach(() => { store = new MemoryStore(openDb(':memory:')); });

  it('embeds only rows needing it and writes the vectors back', async () => {
    const a = store.add(1, { body: 'alpha' }, 'agent', '');
    const emb = fakeEmbedder();
    const q = new EmbeddingQueue({ memoryStore: store, embeddings: emb, users: roster(1), embeddingConfig: () => CFG });

    await q.drain();
    expect(emb.calls).toEqual(['alpha']);
    const stored = store.getEmbedding(1, a.id);
    expect(stored).toBeDefined();
    expect(stored!.dimensions).toBe(4);
    expect(stored!.provider).toBe('openai');
    expect(stored!.model).toBe('text-embedding-3-small');
    expect(stored!.content_hash).toBe(hashBody('alpha'));

    // A newly added memory is the only thing embedded on the next drain — 'alpha' is already done.
    const b = store.add(1, { body: 'beta' }, 'agent', '');
    emb.calls.length = 0;
    await q.drain();
    expect(emb.calls).toEqual(['beta']);
    expect(store.getEmbedding(1, b.id)).toBeDefined();
  });

  it('re-drain is a no-op once everything is embedded', async () => {
    store.add(1, { body: 'one' }, 'agent', '');
    store.add(1, { body: 'two' }, 'agent', '');
    const emb = fakeEmbedder();
    const q = new EmbeddingQueue({ memoryStore: store, embeddings: emb, users: roster(1), embeddingConfig: () => CFG });

    await q.drain();
    expect(emb.calls.sort()).toEqual(['one', 'two']);
    emb.calls.length = 0;
    await q.drain();
    expect(emb.calls).toEqual([]);
  });

  it('re-embeds a memory after its body is edited (stale vector)', async () => {
    const m = store.add(1, { body: 'first' }, 'agent', '');
    const emb = fakeEmbedder();
    const q = new EmbeddingQueue({ memoryStore: store, embeddings: emb, users: roster(1), embeddingConfig: () => CFG });
    await q.drain();

    store.update(1, m.id, { body: 'edited' }, 'agent', '');
    emb.calls.length = 0;
    await q.drain();
    expect(emb.calls).toEqual(['edited']);
    expect(store.getEmbedding(1, m.id)!.content_hash).toBe(hashBody('edited'));
  });

  it('is a no-op when embeddings are not configured', async () => {
    store.add(1, { body: 'x' }, 'agent', '');
    const emb = fakeEmbedder();
    // Empty model → not configured.
    const q = new EmbeddingQueue({ memoryStore: store, embeddings: emb, users: roster(1), embeddingConfig: () => ({ providerId: 'openai', model: '' }) });
    await q.drain();
    expect(emb.calls).toEqual([]);
    // Missing providerId → also not configured.
    const q2 = new EmbeddingQueue({ memoryStore: store, embeddings: emb, users: roster(1), embeddingConfig: () => ({ model: 'm' }) });
    await q2.drain();
    expect(emb.calls).toEqual([]);
  });

  it('isolates a throwing embed — other rows still embed', async () => {
    store.add(1, { body: 'good-1' }, 'agent', '');
    const boom = store.add(1, { body: 'BOOM' }, 'agent', '');
    store.add(1, { body: 'good-2' }, 'agent', '');
    const emb: Embedder & { calls: string[] } = {
      calls: [],
      async embed(_cfg, text) {
        (emb.calls as string[]).push(text);
        if (text === 'BOOM') throw new Error('provider exploded');
        return Float32Array.from([1, 2, 3, 4]);
      },
    } as Embedder & { calls: string[] };
    const q = new EmbeddingQueue({ memoryStore: store, embeddings: emb, users: roster(1), embeddingConfig: () => CFG });

    await q.drain();
    expect(emb.calls.sort()).toEqual(['BOOM', 'good-1', 'good-2']);
    // The two good memories are embedded; the failing one has no stored vector.
    const rows = store.list(1);
    const good = rows.filter((r) => r.body.startsWith('good'));
    for (const r of good) expect(store.getEmbedding(1, r.id)).toBeDefined();
    expect(store.getEmbedding(1, boom.id)).toBeUndefined();
  });

  it('honors the per-tick cap, spreading the backlog across drains', async () => {
    for (let i = 0; i < 5; i++) store.add(1, { body: `mem-${i}` }, 'agent', '');
    const emb = fakeEmbedder();
    const q = new EmbeddingQueue({ memoryStore: store, embeddings: emb, users: roster(1), embeddingConfig: () => CFG, maxPerDrain: 2 });

    await q.drain();
    expect(emb.calls).toHaveLength(2);
    await q.drain();
    expect(emb.calls).toHaveLength(4);
    await q.drain();
    expect(emb.calls).toHaveLength(5); // only one left
    await q.drain();
    expect(emb.calls).toHaveLength(5); // fully drained
  });

  it('skips an overlapping drain — a slow in-flight drain is not double-processed', async () => {
    store.add(1, { body: 'slow-mem' }, 'agent', '');
    // A gated embedder: embed() blocks until release() is called, so we can hold one drain in-flight
    // and fire a second (overlapping) tick while the first is still awaiting the provider.
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const calls: string[] = [];
    const emb: Embedder = {
      async embed(_cfg, text) {
        calls.push(text);
        await gate;
        return Float32Array.from([1, 2, 3, 4]);
      },
    };
    const q = new EmbeddingQueue({ memoryStore: store, embeddings: emb, users: roster(1), embeddingConfig: () => CFG });

    const first = q.drain();          // enters embed(), blocks on the gate
    await Promise.resolve();          // let the first drain reach its await
    await q.drain();                  // overlapping tick — must be skipped (returns immediately)
    expect(calls).toEqual(['slow-mem']); // NOT double-embedded

    release();
    await first;
    expect(calls).toEqual(['slow-mem']); // still exactly one embed total

    // The guard is released after a drain finishes, so a later drain runs normally again.
    store.add(1, { body: 'next-mem' }, 'agent', '');
    await q.drain();
    expect(calls).toEqual(['slow-mem', 'next-mem']);
  });

  it('embeds each user under their own id (per-user scoping)', async () => {
    const a = store.add(1, { body: 'u1 memory' }, 'agent', '');
    const b = store.add(2, { body: 'u2 memory' }, 'agent', '');
    const emb = fakeEmbedder();
    const q = new EmbeddingQueue({ memoryStore: store, embeddings: emb, users: roster(1, 2), embeddingConfig: () => CFG });
    await q.drain();
    expect(store.getEmbedding(1, a.id)).toBeDefined();
    expect(store.getEmbedding(2, b.id)).toBeDefined();
    // Cross-user lookups find nothing (ownership enforced by the store).
    expect(store.getEmbedding(2, a.id)).toBeUndefined();
  });
});
