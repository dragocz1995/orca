import type { MissionTask, MissionDeps } from '../../lib/types';

// Topological layering: a task's phase = 0 if it has no dependency within the set,
// else 1 + max(phase of its deps). Cycle-safe via a visiting guard (a back-edge
// contributes no increase, so a cycle resolves to finite phases rather than looping).
export function layoutPhases(tasks: MissionTask[], deps: MissionDeps[]): MissionTask[][] {
  const ids = new Set(tasks.map((t) => t.id));
  const depsByTask = new Map<string, string[]>();
  for (const d of deps) {
    if (ids.has(d.taskId) && ids.has(d.dependsOnId)) {
      const list = depsByTask.get(d.taskId) ?? [];
      list.push(d.dependsOnId);
      depsByTask.set(d.taskId, list);
    }
  }
  const phase = new Map<string, number>();
  const visiting = new Set<string>();
  const compute = (id: string): number => {
    const cached = phase.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // back-edge in a cycle — no increase
    visiting.add(id);
    const ds = depsByTask.get(id) ?? [];
    const p = ds.length === 0 ? 0 : 1 + Math.max(...ds.map(compute));
    visiting.delete(id);
    phase.set(id, p);
    return p;
  };
  const layered: MissionTask[][] = [];
  for (const task of tasks) {
    const p = compute(task.id);
    (layered[p] ??= []).push(task);
  }
  // collapse any gaps (defensive — layers are 0..max contiguous by construction, but guard sparse arrays)
  return layered.filter((layer) => layer !== undefined);
}
