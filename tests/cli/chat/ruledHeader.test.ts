import { describe, it, expect } from 'vitest';
import { visibleWidth } from '@earendil-works/pi-tui';
import { ruledHeader, ProcessPanel, SubagentPanel, WorkflowPanel } from '../../../src/cli/chat/components.js';
import { TelemetryPanel, type TelemetryState } from '../../../src/cli/chat/telemetryPanel.js';
import type { ProcessInfo } from '../../../src/brain/processRegistry.js';

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('ruledHeader', () => {
  it('fills the row to the exact width with a trailing rule', () => {
    const row = ruledHeader('─ Context', 36);
    expect(visibleWidth(row)).toBe(36);
    expect(strip(row)).toMatch(/^─ Context ─+$/);
  });

  it('truncates over-wide content instead of overflowing', () => {
    const row = ruledHeader(`─ ${'a'.repeat(60)}`, 36);
    expect(visibleWidth(row)).toBe(36);
    expect(strip(row)).toContain('…');
  });

  it('keeps a single rule cell next to the content at minimum width', () => {
    const row = ruledHeader('─ LSP', 7);
    expect(visibleWidth(row)).toBe(7);
    expect(strip(row)).toBe('─ LSP ─');
  });
});

const telemetryState = (over: Partial<TelemetryState> = {}): TelemetryState => ({
  usage: { tokens: 10, contextWindow: 100, percent: 10, totalTokens: 20, cost: 0 },
  cwd: '~/elowen',
  branch: 'main',
  mcp: [{ name: 'chrome-devtools', status: 'connected' }],
  lspEnabled: true,
  processes: [],
  subagents: [],
  rateLimits: null,
  goal: null,
  floatOffset: 0,
  ...over,
});

describe('ruled section headers in the telemetry rail', () => {
  it('renders Context, Project, MCP and LSP headers as ruled rows at panel width', () => {
    const rows = new TelemetryPanel(() => telemetryState()).render(46).map(strip);
    for (const label of ['Context', 'Project', 'MCP', 'LSP']) {
      const header = rows.find((line) => line.startsWith('─ ') && line.includes(label));
      expect(header, label).toBeDefined();
      expect(header!.length).toBe(46);
      expect(header).toMatch(/─$/);
    }
  });

  it('keeps section meta (counts) inside the ruled header row', () => {
    const rows = new TelemetryPanel(() => telemetryState()).render(46).map(strip).join('\n');
    expect(rows).toMatch(/─ MCP 1\/1 active ─+/);
  });
});

describe('ruled headers in the live list panels', () => {
  it('ProcessPanel header keeps counter and click hint, then rules out the row', () => {
    const proc: ProcessInfo = {
      id: 'p1', command: 'npm run dev', startedAt: new Date().toISOString(),
      running: true, completionMode: 'background',
    } as ProcessInfo;
    const panel = new ProcessPanel();
    panel.set([proc]);
    const header = strip(panel.render(46)[0]!);
    expect(header).toMatch(/^─ ▾ Processes  1 running click ✕ ─+$/);
    expect(header.length).toBe(46);
  });

  it('SubagentPanel and WorkflowPanel headers rule out the row and keep the collapse glyph', () => {
    const sub = new SubagentPanel();
    sub.set([{ sessionId: 's1', task: 'do a thing', status: 'running', tools: 1, seconds: 3 }]);
    const subHeader = strip(sub.render(46)[0]!);
    expect(subHeader).toMatch(/^─ ▾ Sub-agents  1 click ─+$/);

    const wf = new WorkflowPanel();
    wf.set([{ id: 'w1', title: 'Refactor', status: 'running', nodes: [] } as never]);
    const wfHeader = strip(wf.render(46)[0]!);
    expect(wfHeader).toMatch(/^─ ▾ Workflow  1 click ─+$/);
  });

  it('collapsed panels keep the ▸ glyph inside the ruled header', () => {
    const sub = new SubagentPanel();
    sub.set([{ sessionId: 's1', task: 't', status: 'running', tools: 0, seconds: 1 }]);
    sub.toggleCollapsed();
    expect(strip(sub.render(46)[0]!)).toMatch(/^─ ▸ Sub-agents/);
  });
});
