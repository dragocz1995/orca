import { streamSSE } from 'hono/streaming';
import { resolveExecutor } from '../../overseer/routing.js';
import { classifySession } from '../../overseer/sessionInfo.js';
import { checkoutBusy } from '../../overseer/checkout.js';
import { parseResumeLabel } from '../../spawn/resume/index.js';
import { projectHead } from '../../integrations/projectFiles.js';
import { uniqueName } from '../../daemon/uniqueName.js';
import type { OrcaApp, RouteContext } from '../context.js';

/** Live tmux session surface: list, manual launch, kill, keystrokes/raw input, resize, pane capture,
 *  the live ANSI stream and a single-use ticket for the terminal WebSocket. Every control route is
 *  ownership-gated by sessionAccessible; a manual launch claims the shared checkout atomically. */
export function registerSessionRoutes(app: OrcaApp, ctx: RouteContext): void {
  const { d, sessionAccessible, canAccessProject, execAllowedForUser, pathFor, gitLock, tickets } = ctx;
  app.get('/sessions', async c => c.json((await d.tmux.list())
    .filter((s) => s.startsWith('orca-'))
    // Visibility mirrors operability: a caller only sees sessions it may control (its projects' agents,
    // its own advisor; admin sees all). Without this the list leaked every running session cross-tenant.
    .filter((s) => sessionAccessible(c, s))
    .map((s) => {
      const info = classifySession(s);
      // Tag each session with its project from the agent store (every role upserts there at spawn), so
      // clients can show the repo for workers, pilots and overseers alike — the name alone can't.
      return { ...info, projectId: d.agents?.projectFor(s.slice('orca-'.length)) ?? undefined };
    })));
  app.post('/sessions', async (c) => {
    const { taskId, exec } = await c.req.json() as { taskId: string; exec?: string };
    if (exec && !d.config.get().allowedExecs.includes(exec)) return c.json({ error: 'exec not allowed' }, 400);
    if (exec && !execAllowedForUser(c, exec)) return c.json({ error: 'exec not allowed for user' }, 403);
    const spec = resolveExecutor(exec ? [`exec:${exec}`] : [], d.fallback);
    const task = d.tasks.get(taskId);
    if (!task) return c.json({ error: 'task not found' }, 404); // don't spawn a phantom agent for a missing task
    // Launch in the task's own project (multi-project), gated to the caller's access.
    const projectId = task.project_id;
    if (!canAccessProject(c, projectId)) return c.json({ error: 'forbidden' }, 403);
    if (exec) d.tasks.setExec(taskId, exec); // remember which model ran it — drives the model icon
    // Single-writer: a manual launch targets the shared project checkout, so refuse it when another
    // agent (a scheduler task or a non-PR mission phase) is already live there — a second writer would
    // corrupt per-task change attribution. Read in_progress FRESH and flip status synchronously right
    // after, so the check-and-claim is atomic against the concurrent scheduler/engine ticks.
    const cwd = pathFor(projectId);
    const resolver = { projectPath: pathFor, worktreeFor: (mid: string) => d.missionGit?.worktreeFor(mid) };
    if (checkoutBusy(resolver, d.tasks.list({ status: 'in_progress' }), cwd)) return c.json({ error: 'checkout busy' }, 409);
    const agentName = uniqueName();
    d.tasks.setAgent(taskId, agentName);     // link task → orca-<agentName> session for run controls
    d.tasks.markStarted(taskId, d.clock.now()); // precise spawn time → correct usage attribution under concurrency
    d.tasks.setStatus(taskId, 'in_progress'); // claim synchronously after the fresh check above
    // Baseline for the per-task change snapshot, under the checkout lock so it lands after any in-flight commit.
    await gitLock.run(cwd, async () => d.tasks.markBase(taskId, await projectHead(cwd)));
    // When this is a resume (the task ran before), pin a note so the resumed agent knows it was
    // restarted on purpose and should continue rather than wonder why it's running again. Re-read the
    // description afterwards so the note rides along into the worker-resume prompt.
    const resume = parseResumeLabel(task.labels);
    // Only pin the generic manual-restart note when nothing more specific is already there — a
    // review-reject rationale or a stuck-relaunch reason carries actionable context the user is
    // restarting to address, so don't clobber it with boilerplate.
    if (resume && !d.tasks.get(taskId)?.resume_note) d.tasks.setResumeNote(taskId, 'Manually restarted — continue from where you left off and finish the task.');
    const resumeNote = d.tasks.get(taskId)?.resume_note ?? undefined;
    let session: string;
    try {
      ({ session } = await d.spawn.launch({ projectId, projectPath: pathFor(projectId), taskId, agentName, spec, taskTitle: task.title, taskDescription: task.description, resumeNote, epicId: task.parent_id ?? undefined, resume }));
    } catch (e) {
      // The task was already flipped to in_progress above; a spawn failure (bad cwd, missing tmux,
      // name collision) would otherwise leave it stuck with no live session until the stuck detector
      // reverts it 120s later. Revert immediately so the mission/scheduler can re-pick it.
      d.tasks.setStatus(taskId, 'open');
      d.bus.publish({ type: 'task', taskId, status: 'open' });
      return c.json({ error: `spawn failed: ${(e as Error).message}` }, 500);
    }
    d.bus.publish({ type: 'task', taskId, status: 'in_progress' });
    return c.json({ session }, 201);
  });
  app.delete('/sessions/:name', async c => {
    const name = c.req.param('name');
    if (!sessionAccessible(c, name)) return c.json({ error: 'forbidden' }, 403);
    // Killing a user's advisor from the sessions list is an explicit "turn it off" — route it through
    // advisor.stop so it also persists advisor_autostart=false. A bare tmux.kill would leave the flag
    // on, and ensureOnLogin would resurrect the advisor on the next login (the "it comes back after I
    // killed it" bug). Plain agent/overseer sessions just get killed.
    const info = classifySession(name);
    if (info.role === 'advisor' && info.userId !== undefined && d.advisor) {
      await d.advisor.stop(info.userId);
      return c.json({ ok: true });
    }
    await d.tmux.kill(name); return c.json({ ok: true });
  });
  app.post('/sessions/:name/keys', async c => {
    if (!sessionAccessible(c, c.req.param('name'))) return c.json({ error: 'forbidden' }, 403);
    const { keys } = await c.req.json().catch(() => ({})) as { keys?: unknown };
    // Validate before handing to `tmux send-keys`: it must be a non-empty list of plain key tokens.
    // Reject anything starting with '-' so a crafted entry can't smuggle a tmux flag (e.g. `-t
    // <other-session>`) and redirect keystrokes into a session the caller shouldn't reach.
    if (!Array.isArray(keys) || keys.length === 0 || !keys.every((k) => typeof k === 'string' && k.length > 0 && !k.startsWith('-'))) {
      return c.json({ error: 'keys must be a non-empty array of non-flag strings' }, 400);
    }
    await d.tmux.sendKeys(c.req.param('name'), keys as string[]);
    return c.json({ ok: true });
  });
  app.post('/sessions/:name/input', async c => {
    // Raw interactive input: the xterm `onData` bytes (printable chars, control codes, ESC sequences)
    // are forwarded verbatim to the pane via `send-keys -l`, so the advisor terminal behaves like a
    // real one. `-l` + `--` (in the driver) make a leading '-' safe, so no flag-token validation here.
    if (!sessionAccessible(c, c.req.param('name'))) return c.json({ error: 'forbidden' }, 403);
    const { data } = await c.req.json().catch(() => ({})) as { data?: unknown };
    if (typeof data !== 'string' || data.length === 0) return c.json({ error: 'data must be a non-empty string' }, 400);
    await d.tmux.sendRaw(c.req.param('name'), data);
    return c.json({ ok: true });
  });
  app.post('/sessions/:name/resize', async c => {
    if (!sessionAccessible(c, c.req.param('name'))) return c.json({ error: 'forbidden' }, 403);
    const { cols, rows } = await c.req.json() as { cols?: number; rows?: number };
    if (typeof cols !== 'number' || typeof rows !== 'number') return c.json({ error: 'cols and rows required' }, 400);
    await d.tmux.resize(c.req.param('name'), cols, rows);
    return c.json({ ok: true });
  });
  app.get('/sessions/:name/pane', async c => {
    const name = c.req.param('name');
    if (!sessionAccessible(c, name)) return c.json({ error: 'forbidden' }, 403);
    const pane = c.req.query('ansi') ? await d.tmux.capturePaneAnsi(name, 60) : await d.tmux.capturePane(name, 60);
    return c.json({ pane });
  });

  app.get('/sessions/:name/stream', (c) => {
    const name = c.req.param('name');
    if (!sessionAccessible(c, name)) return c.json({ error: 'forbidden' }, 403);
    return streamSSE(c, async (stream) => {
      let done = false;          // flips once: on abort, on too many errors, or on normal exit
      const frame = async () => {
        const pane = await d.tmux.capturePaneAnsi(name, 200);
        await stream.writeSSE({ data: JSON.stringify({ pane }), event: 'pane' });
      };
      await frame(); // first frame synchronously so clients render immediately
      let errs = 0;
      // capturePaneAnsi returns '' for a vanished session, so a throw here means the write failed
      // (closed client). After a short run of consecutive failures, stop pushing empty frames forever.
      const clear = d.clock.setInterval(() => {
        frame().then(() => { errs = 0; }).catch(() => { if (++errs >= 5) done = true; });
      }, 1000);
      // Single teardown: the abort listener flips `done`; the loop exits and `clear()` runs exactly
      // once (the previous code called stop() on both abort and loop-exit — a redundant double-clear).
      c.req.raw.signal.addEventListener('abort', () => { done = true; });
      while (!done && !c.req.raw.signal.aborted) await stream.sleep(1000);
      clear();
    });
  });

  // Mint a single-use ticket to open the terminal WebSocket stream for this session. Authenticated
  // here (via the BFF cookie) and ownership-gated by the same access check as every session route; the
  // unauthenticated `/ws/terminal` upgrade then redeems the ticket. The attach is interactive.
  app.post('/sessions/:name/ws-ticket', async (c) => {
    const name = c.req.param('name');
    if (!sessionAccessible(c, name)) return c.json({ error: 'forbidden' }, 403);
    const ticket = tickets.issue({ session: name, userId: c.get('user')?.id ?? null });
    return c.json({ ticket });
  });
}
