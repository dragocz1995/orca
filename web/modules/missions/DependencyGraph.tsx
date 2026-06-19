'use client';
import type { MissionTask, MissionDeps } from '../../lib/types';
import { layoutPhases } from './layoutPhases';
import { taskTypeMeta } from '../tasks/taskMeta';
import { useTranslation } from '../../lib/i18n';

const COL_W = 230, ROW_H = 78, NODE_W = 188, NODE_H = 54, PAD = 14;
const STATUS_COLOR: Record<string, string> = {
  closed: 'var(--color-success)', in_progress: 'var(--color-info)', blocked: 'var(--color-error)', cancelled: 'var(--color-cancelled)', open: 'var(--color-cancelled)',
};
const isTerminal = (s: string) => s === 'closed' || s === 'cancelled';

/** A dependency edge is a fail-gate when its source (blocker) closed with a 'fail'
 *  outcome or was cancelled — downstream work cannot proceed cleanly past it. */
function isFailGate(dep: MissionTask): boolean {
  if (dep.status === 'cancelled') return true;
  if (dep.status === 'closed' && dep.outcome === 'fail') return true;
  return false;
}

/** Node-link dependency graph of an epic's tasks, laid out by topological phase. */
export function DependencyGraph({ tasks, deps, onSelect }: { tasks: MissionTask[]; deps: MissionDeps[]; onSelect?: (id: string) => void }) {
  const { t } = useTranslation();
  const phases = layoutPhases(tasks, deps);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const pos = new Map<string, { x: number; y: number }>();
  phases.forEach((layer, li) => layer.forEach((t, ri) => pos.set(t.id, { x: PAD + li * COL_W, y: PAD + ri * ROW_H })));
  const maxRows = Math.max(1, ...phases.map((l) => l.length));
  const width = PAD * 2 + Math.max(1, phases.length) * COL_W - (COL_W - NODE_W);
  const height = PAD * 2 + maxRows * ROW_H - (ROW_H - NODE_H);

  // A task's dependencies, and whether it is "ready" (all deps terminal) vs "locked".
  const depsByTask = new Map<string, string[]>();
  for (const d of deps) {
    if (byId.has(d.taskId) && byId.has(d.dependsOnId)) {
      const list = depsByTask.get(d.taskId) ?? [];
      list.push(d.dependsOnId);
      depsByTask.set(d.taskId, list);
    }
  }
  const ready = (t: MissionTask) => t.status === 'open' && (depsByTask.get(t.id) ?? []).every((id) => isTerminal(byId.get(id)?.status ?? 'open'));
  const locked = (t: MissionTask) => t.status === 'open' && !ready(t);

  const edges = deps.filter((d) => pos.has(d.taskId) && pos.has(d.dependsOnId));
  // A node carries a fail-gate marker when any of its dependencies is a fail-gate.
  const gatedTaskIds = new Set<string>();
  for (const d of deps) {
    const dep = byId.get(d.dependsOnId);
    if (dep && isFailGate(dep) && byId.has(d.taskId)) gatedTaskIds.add(d.taskId);
  }

  return (
    <div className="overflow-auto rounded-lg border border-border bg-bg p-1">
      <svg width={width} height={height} style={{ minWidth: width, display: 'block' }}>
        {/* dependency edges: blocker → dependent */}
        {edges.map((d, i) => {
          const a = pos.get(d.dependsOnId)!;
          const b = pos.get(d.taskId)!;
          const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const dep = byId.get(d.dependsOnId);
          const done = isTerminal(dep?.status ?? '');
          const fail = dep ? isFailGate(dep) : false;
          const stroke = fail ? 'var(--color-danger)' : done ? 'var(--color-success)' : 'var(--color-border-strong)';
          return (
            <path
              key={i}
              className="animate-draw"
              pathLength={1}
              style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={stroke}
              strokeWidth={fail ? 1.6 : done ? 1.6 : 1.2}
              strokeDasharray={fail ? '5 3' : undefined}
              opacity={fail ? 0.85 : done ? 0.8 : 0.55}
            />
          );
        })}
        {/* nodes */}
        {tasks.map((task, ni) => {
          const p = pos.get(task.id);
          if (!p) return null;
          const c = STATUS_COLOR[task.status] ?? 'var(--color-cancelled)';
          const dim = locked(task);
          const running = task.status === 'in_progress';
          const isReady = ready(task);
          const gated = gatedTaskIds.has(task.id);
          const Icon = taskTypeMeta(task.type).icon;
          const border = gated ? 'var(--color-danger)' : running ? 'var(--color-info)' : isReady ? 'var(--color-info)' : 'var(--color-border)';
          const gateLabel = t.missions.failGate;
          return (
            <foreignObject key={task.id} x={p.x} y={p.y} width={NODE_W} height={NODE_H}>
              <div
                onClick={() => onSelect?.(task.id)}
                className={`animate-pop-in relative flex h-full items-center gap-2 rounded-lg border bg-surface px-2.5 ${onSelect ? 'cursor-pointer' : ''}`}
                style={{ borderColor: border, borderWidth: running || isReady || gated ? 1.5 : 1, opacity: dim ? 0.55 : 1, animationDelay: `${Math.min(ni, 10) * 40}ms` }}
                title={gated ? `${task.title} — ${gateLabel}` : task.title}
              >
                {gated ? (
                  <span
                    className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-bg bg-danger text-[9px] font-bold text-bg"
                    title={gateLabel}
                    aria-label={gateLabel}
                  >!</span>
                ) : null}
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${running ? 'live-dot' : ''}`} style={{ backgroundColor: c, ['--live-ring' as string]: 'color-mix(in srgb, var(--color-info) 50%, transparent)' }} aria-hidden />
                <Icon size={13} className="shrink-0 text-text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] leading-tight text-text">{task.title}</div>
                  <div className="text-tiny capitalize text-text-muted">{isReady ? 'ready' : task.status.replace('_', ' ')}</div>
                </div>
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}
