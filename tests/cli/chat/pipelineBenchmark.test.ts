import { describe, expect, it } from 'vitest';
import { getMarkdownTheme, initTheme } from '@earendil-works/pi-coding-agent';
import { TranscriptModel } from '../../../src/brain/transcriptModel.js';
import { ChatViewport } from '../../../src/cli/chat/chatViewport.js';
// The benchmark is an executable repository script rather than compiled application source.
// @ts-expect-error JavaScript benchmark modules intentionally have no declaration file.
import {
  PIPELINE_HISTORY_TURNS,
  PIPELINE_SAMPLE_COUNT,
  runPipelineBenchmark,
  summarizeTimings,
  validatePipelineBenchmarkReport,
} from '../../../scripts/tests/cli-pipeline-benchmark.mjs';

const boundedOperations = () => ({
  reducerTurnVisits: { total: 2, maxPerEvent: 1 },
  viewportTurnVisits: { total: 2, maxPerFrame: 1 },
  renderedTurns: { total: 0, maxPerFrame: 0 },
  reconciledTurns: { total: 2, maxPerFrame: 1 },
  indexedTurns: { initial: 13, final: 13, max: 13, maxDeltaPerFrame: 0 },
  cachedRows: { initial: 26, final: 26, max: 26 },
  layoutVisits: { total: 0, maxPerFrame: 0 },
  heightIndexOperations: { totalDelta: 160, maxDeltaPerFrame: 80 },
  scrollOffset: { initial: 0, final: 0, min: 0, max: 0 },
  maxScrollOffset: { initial: 8, final: 8, min: 8, max: 8 },
});

describe('CLI whole-pipeline benchmark contract', () => {
  it('reports reducer and complete event-to-frame timings for every required history size', () => {
    expect(PIPELINE_HISTORY_TURNS).toEqual([200, 10_000, 40_000]);
    expect(PIPELINE_SAMPLE_COUNT).toBe(20);

    const report = {
      benchmark: 'cli-brain-event-to-frame',
      samples: 2,
      results: PIPELINE_HISTORY_TURNS.map((historyTurns: number) => ({
        historyTurns,
        eventType: 'subagent',
        reducerMs: { average: 1, p95: 2 },
        eventToFrameMs: { average: 3, p95: 4 },
        operations: boundedOperations(),
      })),
    };

    expect(() => validatePipelineBenchmarkReport(report)).not.toThrow();
  });

  it('rejects a render-only result that omits reducer timing', () => {
    const renderOnly = {
      benchmark: 'cli-brain-event-to-frame',
      samples: 1,
      results: PIPELINE_HISTORY_TURNS.map((historyTurns: number) => ({
        historyTurns,
        eventType: 'subagent',
        eventToFrameMs: { average: 1, p95: 1 },
        operations: boundedOperations(),
      })),
    };

    expect(() => validatePipelineBenchmarkReport(renderOnly)).toThrow(/reducerMs/);
  });

  it('rejects timing-only evidence and any steady event that visits more than one turn', () => {
    const timingOnly = {
      benchmark: 'cli-brain-event-to-frame',
      samples: 20,
      results: PIPELINE_HISTORY_TURNS.map((historyTurns: number) => ({
        historyTurns,
        eventType: 'subagent',
        reducerMs: { average: 1, p95: 2 },
        eventToFrameMs: { average: 3, p95: 4 },
      })),
    };
    expect(() => validatePipelineBenchmarkReport(timingOnly)).toThrow(/operations/);

    const unbounded = structuredClone(timingOnly);
    unbounded.results = PIPELINE_HISTORY_TURNS.map((historyTurns: number) => ({
      historyTurns,
      eventType: 'subagent',
      reducerMs: { average: 1, p95: 2 },
      eventToFrameMs: { average: 3, p95: 4 },
      operations: {
        ...boundedOperations(),
        reducerTurnVisits: { total: 40, maxPerEvent: 2 },
      },
    }));
    expect(() => validatePipelineBenchmarkReport(unbounded)).toThrow(/reducerTurnVisits/);
  });

  it('hard-gates viewport work independently of history depth', () => {
    const report = {
      benchmark: 'cli-brain-event-to-frame',
      samples: 20,
      results: PIPELINE_HISTORY_TURNS.map((historyTurns: number) => ({
        historyTurns,
        eventType: 'subagent',
        reducerMs: { average: 1, p95: 2 },
        eventToFrameMs: { average: 3, p95: 4 },
        operations: {
          ...boundedOperations(),
          layoutVisits: { total: 40_000, maxPerFrame: historyTurns },
        },
      })),
    };
    expect(() => validatePipelineBenchmarkReport(report)).toThrow(/layoutVisits/);
  });

  it('executes reduction, state handoff and viewport rendering at every required history size', async () => {
    const visits = { apply: 0, setState: 0, render: 0 };
    class InstrumentedViewport extends ChatViewport {
      override setState(next: Parameters<ChatViewport['setState']>[0]): void {
        visits.setState++;
        super.setState(next);
      }
      override render(width: number): string[] {
        visits.render++;
        return super.render(width);
      }
    }
    class InstrumentedTranscriptModel extends TranscriptModel {
      override apply(event: Parameters<TranscriptModel['apply']>[0]): boolean {
        visits.apply++;
        return super.apply(event);
      }
    }

    const report = await runPipelineBenchmark({
      samples: 2,
      runtime: {
        initTheme,
        getMarkdownTheme,
        ChatViewport: InstrumentedViewport,
        TranscriptModel: InstrumentedTranscriptModel,
      },
    });

    expect(report.results.map((result: { historyTurns: number }) => result.historyTurns))
      .toEqual([200, 10_000, 40_000]);
    expect(visits).toEqual({ apply: 6, setState: 6, render: 9 });
    expect(report.results.every((result: { reducerMs: { average: number }; eventToFrameMs: { average: number } }) =>
      result.reducerMs.average >= 0 && result.eventToFrameMs.average >= result.reducerMs.average)).toBe(true);
    expect(report.results.every((result: { operations: ReturnType<typeof boundedOperations> }) =>
      result.operations.reducerTurnVisits.maxPerEvent <= 1
      && result.operations.viewportTurnVisits.maxPerFrame <= 1
      && result.operations.renderedTurns.maxPerFrame <= 1
      && result.operations.reconciledTurns.maxPerFrame <= 1
      && result.operations.indexedTurns.maxDeltaPerFrame <= 1
      && result.operations.cachedRows.max <= 2_048
      && result.operations.layoutVisits.maxPerFrame <= 1
      && result.operations.heightIndexOperations.maxDeltaPerFrame <= 512
      && result.operations.scrollOffset.max === 0)).toBe(true);
  });

  it('uses conventional nearest-rank p95 for twenty samples', () => {
    expect(summarizeTimings(Array.from({ length: 20 }, (_, index) => index + 1))).toEqual({
      average: 10.5,
      p95: 19,
    });
  });
});
