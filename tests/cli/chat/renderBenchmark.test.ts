import { describe, expect, it } from 'vitest';
// The benchmark is an executable repository script rather than compiled application source.
// @ts-expect-error JavaScript benchmark modules intentionally have no declaration file.
import {
  summarizeViewportTimings,
  validateViewportBenchmarkReport,
} from '../../../scripts/tests/cli-render-benchmark.mjs';

describe('CLI viewport benchmark contract', () => {
  it('uses the same conventional nearest-rank p95 as the pipeline benchmark', () => {
    expect(summarizeViewportTimings(Array.from({ length: 20 }, (_, index) => index + 1))).toEqual({
      average: 10.5,
      p95: 19,
    });
  });

  it('requires final structural viewport metrics in every result', () => {
    const report = {
      benchmark: 'cli-viewport-frame',
      samples: { scroll: 40, stream: 40 },
      results: [100, 1_000, 5_000].map((pairs) => ({
        pairs,
        turns: pairs * 2 + 1,
        initialMs: 1,
        scrollAvgMs: 1,
        scrollP95Ms: 2,
        streamAvgMs: 1,
        streamP95Ms: 2,
        finalViewport: {
          renderMs: 1,
          transcriptRows: 20,
          transcriptRowsExact: false,
          visibleRows: 18,
          renderedTurns: 1,
          reconciledTurns: 1,
          indexedTurns: 14,
          cachedRows: 30,
          layoutVisits: 1,
          scrollOffset: 0,
          maxScrollOffset: 2,
          heightIndexOperations: 120,
        },
      })),
    };
    expect(() => validateViewportBenchmarkReport(report)).not.toThrow();

    const missingMetrics = structuredClone(report);
    delete (missingMetrics.results[0] as { finalViewport?: unknown }).finalViewport;
    expect(() => validateViewportBenchmarkReport(missingMetrics)).toThrow(/finalViewport/);
  });
});
