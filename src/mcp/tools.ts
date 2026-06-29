import { callOrcaApi } from '../shared/apiClient.js';

/** The Orca MCP toolset, built over the single shared `callOrcaApi` core — exactly the same forward
 *  path as the `orca api` CLI verb, so there is no duplicated request logic and a new REST endpoint
 *  needs zero edits here. `orca_request` is the generic escape hatch (any endpoint works immediately);
 *  the typed helpers are thin fixed-route wrappers that exist only for nicer agent UX. */
export interface OrcaToolDeps { url: string; token: string; call?: typeof callOrcaApi }

export function makeOrcaTools(d: OrcaToolDeps) {
  const call = d.call ?? callOrcaApi;
  const req = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const r = await call(method, path, body, { url: d.url, token: d.token });
    if (!r.ok) throw new Error(`orca ${r.status}: ${r.text || JSON.stringify(r.data)}`);
    return r.data;
  };
  return {
    orca_request: (a: { method: string; path: string; body?: unknown }) => req(a.method, a.path, a.body),
    orca_tasks: () => req('GET', '/tasks'),
    orca_create_task: (a: { title: string; project_id?: number; description?: string }) => req('POST', '/tasks', a),
    orca_plan: (a: {
      goal: string;
      project_id?: number;
      name?: string;
      exec?: string;
      autoModel?: boolean;
      autonomy?: string;
      maxSessions?: number;
      engage?: boolean;
      dryRun?: boolean;
      prompt?: string;
      prEnabled?: boolean | null;
    }) => req('POST', '/tasks/plan', a),
    orca_sessions: () => req('GET', '/sessions'),
    orca_note_add: (a: { target: string; body: string }) => req('POST', '/notes', { scope: 'mission', target: a.target, body: a.body }),
    orca_notes: (a: { target: string }) => req('GET', `/notes?scope=mission&target=${encodeURIComponent(a.target)}`),
    // Mission lifecycle — engage spawns the autopilot on an epic; pause/resume/disengage drive its state.
    orca_missions: () => req('GET', '/missions'),
    orca_mission_engage: (a: { epicId: string; autonomy?: string; maxSessions?: number }) => req('POST', '/missions', a),
    orca_mission_pause: (a: { id: string }) => req('PATCH', `/missions/${encodeURIComponent(a.id)}`, { action: 'pause' }),
    orca_mission_resume: (a: { id: string }) => req('PATCH', `/missions/${encodeURIComponent(a.id)}`, { action: 'resume' }),
    orca_mission_disengage: (a: { id: string }) => req('DELETE', `/missions/${encodeURIComponent(a.id)}`),
    // Live tmux session control — spawn a worker for a task, kill it, send keystrokes, read the pane.
    orca_session_spawn: (a: { taskId: string; exec?: string }) => req('POST', '/sessions', a),
    orca_session_kill: (a: { name: string }) => req('DELETE', `/sessions/${encodeURIComponent(a.name)}`),
    orca_session_send_keys: (a: { name: string; keys: string[] }) => req('POST', `/sessions/${encodeURIComponent(a.name)}/keys`, { keys: a.keys }),
    orca_session_read_pane: (a: { name: string; ansi?: boolean }) => req('GET', `/sessions/${encodeURIComponent(a.name)}/pane${a.ansi ? '?ansi=1' : ''}`),
    // Task lifecycle — update fields/status, close with an outcome verdict, read token/cost usage.
    orca_task_update: (a: { id: string; status?: string; title?: string; type?: string; priority?: string; description?: string; exec?: string; deps?: string[] }) => {
      const { id, ...patch } = a;
      return req('PATCH', `/tasks/${encodeURIComponent(id)}`, patch);
    },
    orca_task_close: (a: { id: string; result_summary?: string; outcome?: string }) =>
      req('PATCH', `/tasks/${encodeURIComponent(a.id)}`, { status: 'closed', result_summary: a.result_summary, outcome: a.outcome }),
    orca_task_usage: (a: { id: string }) => req('GET', `/tasks/${encodeURIComponent(a.id)}/usage`),
  };
}
