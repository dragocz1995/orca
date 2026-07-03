import type { MemoryStore, MemoryRow } from '../store/memoryStore.js';
import { hashBody } from '../store/memoryStore.js';
import type { EmbeddingConfig } from './embeddingService.js';
import { isEmbeddingConfigured } from './embeddingService.js';
import type { Logger } from '../shared/logger.js';

/** Minimal slice of EmbeddingService the queue needs — kept narrow so the queue depends on a behavior,
 *  not the concrete class. */
export interface Embedder {
  embed(cfg: EmbeddingConfig, text: string): Promise<Float32Array>;
}

/** The user roster the drain walks. Each active user's own memories are embedded under their id. */
export interface UserRoster {
  list(): { id: number }[];
}

/** How many embeds a single drain() performs before returning, so a large backlog is spread across
 *  ticks instead of stalling one tick (and hogging the provider). A failed embed still counts against
 *  the budget so a persistently broken memory can't monopolize a tick. Override via ctor for tests. */
const DEFAULT_EMBEDS_PER_DRAIN = 50;

export interface EmbeddingQueueDeps {
  memoryStore: MemoryStore;
  embeddings: Embedder;
  users: UserRoster;
  /** Resolves the current embedding config each tick (config can change at runtime). An unusable config
   *  (empty providerId or model) makes drain() a no-op. */
  embeddingConfig: () => EmbeddingConfig;
  logger?: Logger;
  /** Per-tick embed cap; defaults to DEFAULT_EMBEDS_PER_DRAIN. */
  maxPerDrain?: number;
}

/** Background drainer that generates embeddings for memories missing/stale ones, so memory writes never
 *  block on the embeddings provider. Idempotent and stateless: every tick re-derives the pending set
 *  from MemoryStore.needsEmbedding, embeds up to `maxPerDrain` bodies, and writes the vectors back. When
 *  no provider/model is configured (or the config becomes unusable) it no-ops, leaving retrieval to fall
 *  back to keyword search. One bad memory (a throwing embed, a dimension mismatch) is caught and logged
 *  — it never aborts the rest of the drain. */
export class EmbeddingQueue {
  private readonly memoryStore: MemoryStore;
  private readonly embeddings: Embedder;
  private readonly users: UserRoster;
  private readonly embeddingConfig: () => EmbeddingConfig;
  private readonly logger?: Logger;
  private readonly maxPerDrain: number;
  /** In-flight guard: the drain runs on a fixed interval, but a single drain can outlast one tick when the
   *  provider is slow or the backlog is large. Without this, an overlapping tick would re-derive the same
   *  pending set and embed the same bodies again — double work that hammers the provider. Overlapping ticks
   *  are skipped (they'll catch up on the next free tick). */
  private draining = false;

  constructor(deps: EmbeddingQueueDeps) {
    this.memoryStore = deps.memoryStore;
    this.embeddings = deps.embeddings;
    this.users = deps.users;
    this.embeddingConfig = deps.embeddingConfig;
    this.logger = deps.logger;
    this.maxPerDrain = deps.maxPerDrain ?? DEFAULT_EMBEDS_PER_DRAIN;
  }

  /** Embed up to `maxPerDrain` pending memories across all users, writing each vector back. No-op when
   *  the embedding config is not usable. Best-effort per memory: a failed embed is logged and skipped. */
  async drain(): Promise<void> {
    const cfg = this.embeddingConfig();
    if (!isEmbeddingConfigured(cfg)) return;
    // Skip if a previous drain is still running — overlapping ticks would double-embed the same backlog.
    if (this.draining) return;
    this.draining = true;
    try {
      let budget = this.maxPerDrain;
      for (const user of this.users.list()) {
        if (budget <= 0) break;
        // Re-embed not just body-stale rows but also ones embedded under a different model/dimensions —
        // an operator switching the embedding model must re-vectorize existing memories, else their
        // old-width vectors cosine to 0 and silently drop out of ranking.
        const pending = this.memoryStore.needsEmbedding(user.id, { model: cfg.model, dimensions: cfg.dimensions ?? null });
        for (const row of pending) {
          if (budget <= 0) break;
          // Count every attempt (success or failure) against the budget so a broken memory can't loop
          // forever inside one tick — it retries next tick, behind the rest of the backlog.
          budget -= 1;
          await this.embedOne(cfg, user.id, row);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async embedOne(cfg: EmbeddingConfig, userId: number, row: MemoryRow): Promise<void> {
    try {
      const vec = await this.embeddings.embed(cfg, row.body);
      this.memoryStore.setEmbedding(userId, row.id, {
        provider: cfg.providerId ?? '',
        model: cfg.model,
        dimensions: vec.length,
        vector: vec,
        // Re-hash the CURRENT body so an edit that landed after needsEmbedding still pins correctly.
        contentHash: hashBody(row.body),
      });
    } catch (err) {
      this.logger?.warn('embed failed for memory', { userId, memoryId: row.id, error: String(err) });
    }
  }
}
