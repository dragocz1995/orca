import { basename } from 'node:path';
import { readTaskUsage } from '../../integrations/usage/index.js';
import { projectReviewDiff, projectRangeFileDiff } from '../../integrations/projectFiles.js';
import { snapshotTaskChanges } from '../../overseer/taskSnapshot.js';
import { decompose, parsePhases, modelsBlock, parallelismBlock, VALID_TYPES as VALID_PHASE_TYPES, type Phase } from '../../overseer/planner.js';
import { resolvePrEnabled } from '../../overseer/prMode.js';
import { buildReviewContext } from '../../overseer/reviewContext.js';
import { RelayClient } from '../../inference/client.js';
import { shortId } from '../../shared/id.js';
import type { OrcaApp, RouteContext } from '../context.js';

/** How many times an L3 mission auto-re-spawns a phase that the post-done review rejected before it
 *  gives up and escalates to a human. Mirrors the stuck detector's `maxRelaunch` (2) so the two
 *  bounded-retry loops behave consistently. */
const REVIEW_FIX_BUDGET = 2;

/** Tasks, usage, the post-done review workflow (the heart of the autopilot close path), admin cleanup
 *  and the plan/replan endpoints. The fat business logic here is extracted into services in a later
 *  step; for now the handlers are moved verbatim from createServer. */
export function registerTaskRoutes(app: OrcaApp, ctx: RouteContext): void {
  const {
    d, log, planJobs, decisionQueue, gitLock,
    canAccessProject, notAdmin, accessibleProjects, execAllowedForUser,
    pathFor, usagePathFor, checkoutPathFor, resolveTarget,
    persistPlan, reapPilotSession, finalizePlanJob, releaseGatedDependents,
  } = ctx;
  app.get('/tasks', c => {
    const allowed = accessibleProjects(c);
    const all = d.tasks.list();
    const scoped = allowed ? all.filter((t) => allowed.has(t.project_id)) : all;
    // Optional `?project_id=N` narrows the list to one project. Applied AFTER the access gate so a
    // non-admin can't cross tenancy. An unknown/foreign id simply yields [] (no 404 — benevolent).
    const pidRaw = c.req.query('project_id');
    if (pidRaw !== undefined && pidRaw !== '') {
      const pid = Number(pidRaw);
      if (Number.isFinite(pid)) return c.json(scoped.filter((t) => t.project_id === pid));
    }
    return c.json(scoped);
  });
  app.post('/tasks', async c => {
    const b = await c.req.json() as { title: string; type?: string; priority?: string; id?: string; description?: string; scheduled_at?: string | null; autostart?: number; deps?: string[]; project_id?: number };
    const target = resolveTarget(c, b.project_id);
    if ('error' in target) return c.json({ error: target.error }, target.status);
    const id = b.id ?? shortId(basename(target.project.path));
    const created = d.tasks.create({ id, project_id: target.project.id, title: b.title, type: b.type, priority: b.priority, description: b.description, scheduled_at: b.scheduled_at, autostart: b.autostart });
    if (Array.isArray(b.deps)) d.tasks.setDeps(created.id, b.deps);
    d.bus.publish({ type: 'task', taskId: created.id, status: created.status });
    return c.json(created, 201);
  });
  app.get('/tasks/ready', c => c.json(d.readiness.ready(d.project.id)));
  app.get('/tasks/deps', c => c.json(d.tasks.allDeps()));
  // Token/cost usage for a task's agent run, read from the executor CLI's local session storage
  // (opencode / claude / codex) — portable, no relay. Null usage → no matching session found.
  app.get('/tasks/:id/usage', c => {
    const task = d.tasks.get(c.req.param('id'));
    if (!task) return c.json({ error: 'not found' }, 404);
    if (!canAccessProject(c, task.project_id)) return c.json({ error: 'forbidden' }, 403);
    // Pass the task's own project siblings so usage can disambiguate concurrent agents by start-order
    // rank, and read sessions from that project's path (not the daemon home, under multi-project).
    return c.json(readTaskUsage(task, d.tasks.list({ project_id: task.project_id }), usagePathFor(task), d.fallback));
  });
  // Total token/cost usage aggregated per model (exec spec). Read straight from the `task_usage`
  // snapshots (the UsageRecorder writes one per task as it settles), so this never re-scans the CLIs'
  // session stores. Scoped to the caller's accessible projects; optional `?project_id=N` narrows it.
  app.get('/usage/by-model', c => {
    const allowed = accessibleProjects(c); // Set of project ids, or null for an admin (all projects)
    let projectIds: number[] | undefined = allowed ? [...allowed] : undefined;
    const pidRaw = c.req.query('project_id');
    if (pidRaw !== undefined && pidRaw !== '') {
      const pid = Number(pidRaw);
      if (Number.isFinite(pid)) projectIds = projectIds ? projectIds.filter((p) => p === pid) : [pid];
    }
    return c.json(d.taskUsage?.aggregateByExec(projectIds) ?? []);
  });
  // Reset the usage stats: wipe the `task_usage` snapshots. Admin-only and irreversible, but it only
  // clears Orca's own DB rows — the agents' CLI session transcripts are left untouched.
  app.post('/usage/reset', c => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    return c.json({ ok: true, cleared: d.taskUsage?.deleteAll() ?? 0 });
  });
  app.patch('/tasks/:id', async c => {
    const b = await c.req.json();
    const id = c.req.param('id');
    const existing = d.tasks.get(id);
    if (!existing) return c.json({ error: 'task not found' }, 404);
    if (!canAccessProject(c, existing.project_id)) return c.json({ error: 'forbidden' }, 403);
    if (b.status) {
      if (b.status === 'closed') d.tasks.close(id, { summary: b.result_summary, outcome: b.outcome });
      else d.tasks.setStatus(id, b.status);
      d.bus.publish({ type: 'task', taskId: id, status: b.status });
      // Post-done review (opt-in): when a mission phase closes, let the parked overseer judge the
      // outcome before the next phase may run. This is a HARD sequential gate — the phase's direct
      // dependents are blocked synchronously at close (so the engine tick can't spawn them mid-review),
      // and only an approving verdict releases them. A reject verdict leaves them blocked,
      // so a bad result halts the mission for a human instead of rolling on. Default off, and only
      // active with an agent overseer configured.
      const cfg = d.config.get();
      if (b.status === 'closed' && existing.parent_id) {
        const mission = d.missions.active().find((m) => m.epic_id === existing.parent_id);
        // Tracks whether this close handed the phase to the overseer review gate. When it did, the
        // phase's worktree commit happens on the approving verdict (below); when it didn't, the close
        // is final and we commit right here — so a rejected phase never lands a commit.
        let reviewEnqueued = false;
        if (mission && cfg.autopilot.reviewOnDone && cfg.autopilot.overseerExec) {
          // Close the gate now: block every open direct dependent so no tick spawns it while the review
          // is pending. Track exactly which ones we gated — the verdict releases only these, never a
          // dependent left blocked by a different cause (e.g. an earlier review on another dep).
          const gated: string[] = [];
          for (const e of d.tasks.allDeps()) {
            if (e.depends_on_id !== id) continue;
            const dep = d.tasks.get(e.task_id);
            if (!dep) continue;
            // Gate a direct dependent when it is still 'open', OR when this very phase's earlier review
            // already gated it (an L3 self-heal re-close: the dependent is 'blocked' from the first round,
            // not 'open', so a status check alone would miss it and the mission would strand). The
            // `gatedby:<id>` marker records which review holds it, so the verdict releases only its own gate.
            const gatedByThis = dep.labels.includes(`gatedby:${id}`);
            if (dep.status === 'open' || gatedByThis) {
              if (dep.status !== 'blocked') { d.tasks.setStatus(dep.id, 'blocked'); d.bus.publish({ type: 'task', taskId: dep.id, status: 'blocked' }); }
              if (!gatedByThis) d.tasks.addLabel(dep.id, `gatedby:${id}`);
              gated.push(dep.id);
            }
          }
          // Nothing was gated → nothing downstream to hold back, so there is nothing to review. This is
          // the terminal/leaf phase: closing it also completes the mission, which drains the queue with a
          // synthetic 'mission disengaged' verdict. Reviewing it here would let that synthetic reject
          // resurrect a just-finished phase into an orphaned, mission-less 'open' state. Skip it.
          if (gated.length > 0) {
            reviewEnqueued = true;
            // Hand the overseer the REAL evidence — the working-tree changes — not just the agent's
            // self-reported summary, so the review judges the diff instead of rubber-stamping. Workers
            // don't commit, so `git diff HEAD` is the phase's actual change set. In PR-native mode the
            // agent edits the mission's worktree (and Orca commits each approved phase), so read the diff
            // THERE — the main checkout would show nothing. Without a worktree it's the project checkout,
            // where the diff is cumulative across the sequential mission.
            const reviewPath = checkoutPathFor(mission.id, existing.project_id);
            const { changedFiles, diff } = await projectReviewDiff(reviewPath);
            const reviewCtx = buildReviewContext({ title: existing.title, outcome: b.outcome ?? '', summary: b.result_summary ?? '', changedFiles, diff });
            void decisionQueue.enqueue(mission.id, 'review', reviewCtx)
              .then(async (verdict) => {
                // The mission may have torn down while the review was pending (manual disengage, shutdown):
                // the drain settles the queue with a synthetic reject. Never apply a verdict to a dead
                // mission — releasing or self-healing it would only orphan tasks under a mission that's gone.
                const live = d.missions.get(mission.id);
                if (!live || (live.state !== 'active' && live.state !== 'stalled')) return;
                const approved = verdict.approve;
                // Surface the verdict to the UI/timeline — otherwise the rationale dies in the overseer
                // pane and the user only sees an unexplained 'blocked'/'stalled'.
                d.bus.publish({ type: 'review', missionId: mission.id, taskId: id, approve: approved, rationale: verdict.rationale });
                if (approved) {
                  // Commit the approved phase's work BEFORE the next phase ticks (the worktree in PR
                  // mode, else the shared project checkout) so the next agent never edits it mid-commit.
                  // Under the checkout lock so it can't interleave with the next agent's baseline read —
                  // the snapshot below then has a stable base..HEAD that captures exactly this phase.
                  await gitLock.run(reviewPath, async () => {
                    await d.missionGit?.commitPhase(mission.id, existing.title, reviewPath).catch((e) => log.error('phase commit failed', e));
                    await snapshotTaskChanges(d.tasks, id, reviewPath);
                  });
                  // Gate opens: release the gated dependents and resume so the next phase spawns promptly
                  // rather than waiting up to the 90s interval. resumeStalled (not a bare tick) un-freezes
                  // the mission if it stalled while the verdict was pending — otherwise the freeze would
                  // swallow this tick and the approved work would never run.
                  releaseGatedDependents(id);
                  void d.engine.resumeStalled(mission.id).catch((e) => log.error('post-review resume failed', e));
                  return;
                }
                // Rejected. L3 (full autonomy) self-heals: re-open the phase with the review
                // feedback so the agent fixes it, up to REVIEW_FIX_BUDGET times before escalating. L1/L2
                // (human-in-the-loop) leave it — the dependents stay gated for a human to resolve.
                // A `escalated` verdict (the overseer never answered — a timeout) is NOT a real reject:
                // it must wait for a human, never self-heal. Without this guard a slow/absent overseer
                // turned every phase into an infinite reopen loop. Check it BEFORE bumpReviewFix so a
                // timeout doesn't burn the self-heal budget either.
                const fresh = d.tasks.get(id);
                // Read autonomy from `live` (re-fetched above), not the close-time `mission` snapshot:
                // a re-engage between close and this verdict (e.g. a PR-feedback replan) may have changed
                // it, and the self-heal decision must follow the mission's CURRENT autonomy.
                if (fresh && !verdict.escalated && live.autonomy === 'L3' && d.tasks.bumpReviewFix(id) <= REVIEW_FIX_BUDGET) {
                  // Pin the rejection as a single resume note so a multi-round reject loop refreshes it
                  // instead of stacking duplicate feedback blocks onto the description.
                  d.tasks.setResumeNote(id, `[Review rejected — previous attempt was not accepted]: ${verdict.rationale}\nFix the issue and close the task again.`);
                  // Reap the worker if it outlived its task close, so the re-spawn doesn't collide with a
                  // still-live `orca-<agent>` session ("duplicate session" → endless failed re-spawns).
                  await d.engine.stopTask(id);
                  d.tasks.setStatus(id, 'open'); // re-open so the engine tick re-spawns it (its deps are already satisfied)
                  d.bus.publish({ type: 'task', taskId: id, status: 'open' });
                  // Self-heal is autonomous continuation, not an escalation — resume (un-freeze if it
                  // stalled in the verdict window) so the re-opened phase actually re-spawns.
                  void d.engine.resumeStalled(mission.id).catch((e) => log.error('post-review self-heal resume failed', e));
                } else {
                  // Not self-healed (overseer timeout, L1/L2 human-in-the-loop, or self-heal budget
                  // spent): leave the phase closed and its dependents blocked for a human. Tick so the
                  // mission flips to 'stalled' ("needs attention") now instead of reading 'active' until
                  // the next 90s interval — the escalation must be visible, and the mission waits, never
                  // disengages, until the human resolves it (approve-gate / re-run on the Escalations page).
                  void d.engine.tick(mission.id).catch((e) => log.error('post-review escalation tick failed', e));
                }
              })
              // Fire-and-forget review must never crash the daemon — the verdict apply (or the enqueue
              // itself) can throw, so swallow-and-log instead of leaving an unhandled rejection.
              .catch((e) => log.error('review verdict apply failed', e));
          }
        }
        // When a phase's close is final (no review gate pending), commit its work now — the worktree in
        // PR mode, else the shared project checkout. The review path above commits on approval instead,
        // so a rejected phase never commits.
        if (mission && !reviewEnqueued) {
          const snapPath = checkoutPathFor(mission.id, existing.project_id);
          await gitLock.run(snapPath, async () => {
            await d.missionGit?.commitPhase(mission.id, existing.title, snapPath).catch((e) => log.error('phase commit failed', e));
            await snapshotTaskChanges(d.tasks, id, snapPath);
          });
        }
      } else if (b.status === 'closed') {
        // A standalone task (no mission/worktree): its agent commits into the project checkout, so the
        // frozen change list is base..HEAD there. No-op when nothing was committed (empty snapshot).
        // Under the checkout lock so the range can't straddle a concurrent agent's commit on the same path.
        const snapPath = pathFor(existing.project_id);
        await gitLock.run(snapPath, () => snapshotTaskChanges(d.tasks, id, snapPath));
      }
    }
    if (typeof b.exec === 'string') {
      // Gate the executor exactly like the plan/session routes: an unvalidated exec is stored as an
      // `exec:<spec>` label and later interpolated into the agent launch command, so without this check
      // a project member could set an arbitrary executor (escaping the allow-list) or smuggle shell
      // metacharacters through the model field. Empty string clears the override (revert to fallback).
      if (b.exec && !d.config.get().allowedExecs.includes(b.exec)) return c.json({ error: 'exec not allowed' }, 400);
      if (b.exec && !execAllowedForUser(c, b.exec)) return c.json({ error: 'exec not allowed for user' }, 403);
      d.tasks.setExec(id, b.exec);
    }
    if (typeof b.title === 'string' || typeof b.type === 'string' || typeof b.priority === 'string' || typeof b.description === 'string' || b.scheduled_at !== undefined || b.autostart !== undefined) {
      d.tasks.update(id, { title: b.title, type: b.type, priority: b.priority, description: b.description, scheduled_at: b.scheduled_at, autostart: b.autostart });
    }
    if (Array.isArray(b.deps)) d.tasks.setDeps(id, b.deps);
    return c.json(d.tasks.get(id));
  });
  // Diff of one file from a task's FROZEN change list (the commits it landed between base..head). Read
  // from the mission worktree while it's live, else the project checkout (where the commits merged to).
  // Empty when the task has no snapshot, the file isn't in it, or the refs were GC'd by a later squash.
  app.get('/tasks/:id/changed/diff', async c => {
    const id = c.req.param('id');
    const task = d.tasks.get(id);
    if (!task) return c.json({ error: 'task not found' }, 404);
    if (!canAccessProject(c, task.project_id)) return c.json({ error: 'forbidden' }, 403);
    const path = c.req.query('path') ?? '';
    if (!task.base_sha || !task.head_sha || !path) return c.json({ diff: '' });
    const root = checkoutPathFor(task.parent_id ? `m-${task.parent_id}` : null, task.project_id);
    try {
      return c.json({ diff: await projectRangeFileDiff(root, task.base_sha, task.head_sha, path) });
    } catch {
      return c.json({ diff: '' }); // path-traversal reject / bad ref — degrade to empty, never 500
    }
  });
  // Human approval of an escalated phase: accept its result and release the review gate it holds,
  // re-opening only the dependents no OTHER predecessor still gates (mirrors the agent-approved
  // verdict). The escalations inbox calls this instead of blindly opening every blocked dependent.
  app.post('/tasks/:id/approve-gate', c => {
    const id = c.req.param('id');
    const existing = d.tasks.get(id);
    if (!existing) return c.json({ error: 'task not found' }, 404);
    if (!canAccessProject(c, existing.project_id)) return c.json({ error: 'forbidden' }, 403);
    const released = releaseGatedDependents(id);
    // The escalation froze the whole mission (state 'stalled'); approving here is the human action that
    // un-freezes it. Resume so the released dependents spawn now instead of the mission sitting idle —
    // a stalled mission no longer ticks itself, so without this the approval would release the gate but
    // nothing would ever pick the work up. The phase's parent IS the epic; mission id is `m-<epicId>`.
    if (existing.parent_id) void d.engine.resumeStalled(`m-${existing.parent_id}`).catch((e) => log.error('approve-gate resume failed', e));
    return c.json({ released });
  });

  app.get('/tasks/:id/deps', c => c.json(d.tasks.depsFor(c.req.param('id'))));
  app.delete('/tasks/:id', async c => {
    const id = c.req.param('id');
    const existing = d.tasks.get(id);
    if (!existing) return c.json({ error: 'task not found' }, 404);
    if (!canAccessProject(c, existing.project_id)) return c.json({ error: 'forbidden' }, 403);
    // `?subtree=1` removes a whole mission: disengage it (stops its agents), then delete the epic,
    // every child task, their dependency edges and the mission row — not just the single task.
    if (c.req.query('subtree')) {
      // Mission id is `m-<epicId>` by construction. Stop a still-running mission (kills its agents),
      // then free its worktree UNCONDITIONALLY: a naturally-completed ('disengaged') or paused mission
      // keeps its worktree for the PR/feedback path, so disengage() alone would skip it and leak the
      // on-disk worktree when the epic is deleted (the mission_pr row is also pruned by the cascade).
      const missionId = `m-${id}`;
      const mission = d.missions.get(missionId);
      if (mission && mission.state !== 'disengaged') await d.engine.disengage(missionId).catch(() => { /* best-effort */ });
      await d.missionGit?.cleanup(missionId).catch(() => { /* best-effort */ });
      const removed = d.tasks.deleteEpic(id);
      d.bus.publish({ type: 'task', taskId: id, status: 'cancelled' });
      d.events?.deleteForTarget(id);
      d.notes?.deleteAllForTarget(id); // a removed mission leaves no orphan handoff notes under any scope
      return c.json({ ok: true, tasks: removed.tasks });
    }
    d.tasks.delete(id);
    d.bus.publish({ type: 'task', taskId: id, status: 'cancelled' }); // live SSE so open UIs drop the row
    d.events?.deleteForTarget(id); // purge its history — a removed task leaves no dead feed
    return c.json({ ok: true });
  });
  // Admin maintenance: wipe ALL operational data — tasks (+deps), missions, the activity feed — and
  // stop every live agent session. Projects, users and config are kept. Irreversible; admin-only.
  app.post('/admin/cleanup', async c => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    // Stop missions cleanly first (kills their agents + drains overseers), then sweep any remaining
    // orca- sessions (manual launches / zombies) so no agent keeps running against deleted tasks.
    for (const m of d.missions.live()) await d.engine.disengage(m.id).catch(() => { /* best-effort */ });
    for (const s of (await d.tmux.list()).filter((s) => s.startsWith('orca-'))) {
      await d.tmux.kill(s).catch(() => { /* already gone */ });
    }
    const removed = d.tasks.deleteAll();
    const events = d.events?.deleteAll() ?? 0;
    return c.json({ ok: true, tasks: removed.tasks, missions: removed.missions, events });
  });
  app.post('/tasks/plan', async c => {
    const b = await c.req.json() as { goal?: string; name?: string; exec?: string; autoModel?: boolean; autonomy?: string; maxSessions?: number; engage?: boolean; phases?: { title?: string; type?: string }[]; dryRun?: boolean; prompt?: string; project_id?: number; prEnabled?: boolean | null };
    const goal = (b.goal ?? '').trim();
    const name = (b.name ?? '').trim(); // optional short mission name → epic title (goal stays the description)
    // Tri-state PR override: true (force on) / false (force off) / null|undefined (inherit project+global).
    let prEnabled = b.prEnabled === true ? true : b.prEnabled === false ? false : null;
    // Parallel sessions only materialise in isolated worktrees — a shared checkout is single-writer, so
    // a >1 max_sessions mission would silently serialize to one agent. Opting into parallelism therefore
    // auto-enables PR-native mode, unless the user explicitly turned it off (then we honour their choice).
    if ((b.maxSessions ?? 1) > 1 && prEnabled === null) prEnabled = true;
    if (!goal) return c.json({ error: 'goal required' }, 400);
    if (b.exec && !d.config.get().allowedExecs.includes(b.exec)) return c.json({ error: 'exec not allowed' }, 400);
    if (b.exec && !execAllowedForUser(c, b.exec)) return c.json({ error: 'exec not allowed for user' }, 403);
    const target = resolveTarget(c, b.project_id);
    if ('error' in target) return c.json({ error: target.error }, target.status);

    // Manual mode: explicit phases → synchronous create (no LLM, no key). Keeps the 201 contract.
    if (Array.isArray(b.phases) && b.phases.length > 0) {
      const phases: Phase[] = b.phases.map((p) => ({ title: (p.title ?? '').trim(), type: VALID_PHASE_TYPES.has(p.type ?? '') ? p.type! : 'task' })).filter((p) => p.title);
      if (phases.length === 0) return c.json({ error: 'phases required' }, 400);
      if (b.dryRun === true) return c.json({ phases }); // playground preview, nothing persisted
      const job = planJobs.create({ goal, name, projectId: target.project.id, epicId: null, dryRun: false, exec: b.exec, prEnabled });
      job.phases = phases;
      const { epic, phases: created } = persistPlan(job);
      job.epicId = epic.id;
      planJobs.setPhases(job.id, phases);
      let mission;
      if (b.engage === true) mission = await d.engine.engage({ epicId: epic.id, autonomy: b.autonomy ?? 'L3', maxSessions: b.maxSessions ?? 1, createdBy: c.get('user')?.id ?? null });
      return c.json({ epic, phases: created.map((t) => d.tasks.get(t.id)), mission }, 201);
    }

    // Autopilot mode: always async via a plan job — one path for the relay and the agent backends.
    const cfg = d.config.get();
    const job = planJobs.create({
      goal, name, projectId: target.project.id, epicId: null, dryRun: b.dryRun === true,
      // Auto mode lets the planner pick a model per phase, so no uniform exec rides along.
      exec: b.autoModel ? undefined : b.exec, autoModel: b.autoModel === true,
      engage: b.engage === true ? { autonomy: b.autonomy ?? 'L3', maxSessions: b.maxSessions ?? 1 } : undefined,
      prEnabled, maxSessions: b.maxSessions ?? 1,
    });
    d.bus.publish({ type: 'plan', jobId: job.id, status: 'planning' });
    if (cfg.autopilot.pilotExec && d.pilot) {
      // Agent backend: spawn the Pilot in the repo; it submits via `orca plan submit`.
      void d.pilot(job, target.project.path).catch((e) => { planJobs.fail(job.id, String(e)); d.bus.publish({ type: 'plan', jobId: job.id, status: 'failed', error: String(e) }); reapPilotSession(job); });
      return c.json({ jobId: job.id }, 202);
    }
    // Relay backend: decompose inline and resolve the job before responding.
    const key = d.config.apiKey();
    if (!key) return c.json({ error: 'autopilot_key_missing' }, 400);
    const inf = (d.makeInference ?? ((rc) => new RelayClient(rc)))({ baseUrl: cfg.autopilot.apiUrl, apiKey: key, model: cfg.autopilot.model });
    let phases: Phase[];
    try {
      const notes = d.projects?.get(target.project.id)?.notes;
      const models = job.autoModel ? modelsBlock(cfg.allowedExecs, cfg.modelNotes) : undefined;
      // Same parallelism guidance the agent-mode Pilot gets: parallel branches only when >1 session
      // AND the mission will run PR-native (isolated worktrees), resolved exactly as runtime does.
      const isolated = resolvePrEnabled(prEnabled, d.projects?.get(target.project.id)?.pr_enabled ?? null, cfg.autopilot.prEnabled);
      const parallelism = parallelismBlock(b.maxSessions ?? 1, isolated);
      phases = await decompose(inf, goal, b.prompt ?? cfg.autopilot.prompt, { notes }, models, parallelism);
    } catch {
      planJobs.fail(job.id, 'plan_parse_failed');
      d.bus.publish({ type: 'plan', jobId: job.id, status: 'failed', error: 'plan_parse_failed' });
      return c.json({ jobId: job.id, error: 'plan_parse_failed' }, 502);
    }
    await finalizePlanJob(job.id, phases);
    return c.json({ jobId: job.id, epicId: planJobs.get(job.id)?.epicId ?? null }, 202);
  });

  app.get('/plan/:jobId', (c) => {
    const job = planJobs.get(c.req.param('jobId'));
    if (!job) return c.json({ error: 'not found' }, 404);
    // The Pilot (agent scope) is handed exactly this job's unguessable id and may have no in_progress
    // task yet (it runs during initial planning), so the working-set check doesn't apply — the job id
    // is the capability. Interactive users still go through the project access gate.
    if (c.get('tokenScope') !== 'agent' && !canAccessProject(c, job.projectId)) return c.json({ error: 'forbidden' }, 403);
    return c.json(job);
  });

  app.post('/plan/:jobId/submit', async (c) => {
    const job = planJobs.get(c.req.param('jobId'));
    if (!job) return c.json({ error: 'not found' }, 404);
    if (c.get('tokenScope') !== 'agent' && !canAccessProject(c, job.projectId)) return c.json({ error: 'forbidden' }, 403);
    const body = await c.req.json().catch(() => ({})) as { phases?: unknown };
    let phases: Phase[];
    try { phases = parsePhases(JSON.stringify(body.phases ?? [])); } // reuse the relay validator (DRY)
    catch { return c.json({ error: 'invalid phases' }, 400); }
    await finalizePlanJob(job.id, phases);
    return c.json(planJobs.get(job.id));
  });


  // Insert phases into an existing epic — a manual list of phases, or `goal` to replan
  // (decompose a residual goal). New phases run AFTER the epic's current chain; an active
  // mission picks up the freshly-ready phase on the next tick (triggered immediately here).
  app.post('/tasks/:epicId/phases', async c => {
    const epicId = c.req.param('epicId');
    const epic = d.tasks.get(epicId);
    if (!epic || epic.type !== 'epic') return c.json({ error: 'epic not found' }, 404);
    if (!canAccessProject(c, epic.project_id)) return c.json({ error: 'forbidden' }, 403);
    const b = await c.req.json() as { phases?: { title?: string; type?: string; details?: string }[]; goal?: string; prompt?: string; exec?: string };
    if (b.exec && !d.config.get().allowedExecs.includes(b.exec)) return c.json({ error: 'exec not allowed' }, 400);
    if (b.exec && !execAllowedForUser(c, b.exec)) return c.json({ error: 'exec not allowed for user' }, 403);

    // Manual insert: explicit phases, no LLM, no key. persistPlan appends after the epic's tail.
    if (Array.isArray(b.phases) && b.phases.length > 0) {
      const phases: Phase[] = b.phases.map((p) => ({ title: (p.title ?? '').trim(), type: VALID_PHASE_TYPES.has(p.type ?? '') ? p.type! : 'task', details: (p.details ?? '').trim() || undefined })).filter((p) => p.title);
      if (phases.length === 0) return c.json({ error: 'phases required' }, 400);
      const job = planJobs.create({ goal: epic.description?.trim() || epic.title, projectId: epic.project_id, epicId, dryRun: false, exec: b.exec });
      job.phases = phases;
      const { phases: created } = persistPlan(job);
      const missionId = `m-${epicId}`;
      if (d.engine?.isActive(missionId)) await d.engine.tick(missionId); // pick up the new ready phase
      return c.json({ epic, phases: created.map((t) => d.tasks.get(t.id)) }, 201);
    }
    if (!(b.goal ?? '').trim()) return c.json({ error: 'phases or goal required' }, 400);

    // Replan: decompose the residual goal — async via a plan job scoped to this epic (so an agent
    // Pilot can do it; finalizePlanJob appends + ticks an active mission). One path, relay or agent.
    const cfg = d.config.get();
    // Carry the mission's intended concurrency into the replan so it keeps planning a wide DAG instead
    // of collapsing back to a linear chain. Resolve isolation from the epic's PR label exactly as the
    // runtime does, so the parallelism guidance matches how the replanned phases will actually run.
    const replanOverride = epic.labels.includes('pr:on') ? true : epic.labels.includes('pr:off') ? false : null;
    const replanIsolated = resolvePrEnabled(replanOverride, d.projects?.get(epic.project_id)?.pr_enabled ?? null, cfg.autopilot.prEnabled);
    const replanMaxSessions = d.missions.get(`m-${epicId}`)?.max_sessions ?? 1;
    const replanParallelism = parallelismBlock(replanMaxSessions, replanIsolated);
    const job = planJobs.create({ goal: b.goal!.trim(), projectId: epic.project_id, epicId, dryRun: false, exec: b.exec, prEnabled: replanOverride, maxSessions: replanMaxSessions });
    d.bus.publish({ type: 'plan', jobId: job.id, status: 'planning' });
    if (cfg.autopilot.pilotExec && d.pilot) {
      void d.pilot(job, pathFor(epic.project_id)).catch((e) => { planJobs.fail(job.id, String(e)); d.bus.publish({ type: 'plan', jobId: job.id, status: 'failed', error: String(e) }); });
      return c.json({ jobId: job.id, epicId }, 202);
    }
    const key = d.config.apiKey();
    if (!key) return c.json({ error: 'autopilot_key_missing' }, 400);
    const inf = (d.makeInference ?? ((rc) => new RelayClient(rc)))({ baseUrl: cfg.autopilot.apiUrl, apiKey: key, model: cfg.autopilot.model });
    let phases: Phase[];
    try { phases = await decompose(inf, b.goal!.trim(), b.prompt ?? cfg.autopilot.prompt, { notes: d.projects?.get(epic.project_id)?.notes }, undefined, replanParallelism); }
    catch {
      planJobs.fail(job.id, 'plan_parse_failed');
      d.bus.publish({ type: 'plan', jobId: job.id, status: 'failed', error: 'plan_parse_failed' });
      return c.json({ jobId: job.id, error: 'plan_parse_failed' }, 502);
    }
    await finalizePlanJob(job.id, phases);
    return c.json({ jobId: job.id, epicId }, 202);
  });
}
