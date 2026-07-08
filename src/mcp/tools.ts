import { callElowenApi } from '../shared/apiClient.js';

/** The Elowen MCP toolset, built over the single shared `callElowenApi` core — exactly the same forward
 *  path as the `elowen api` CLI verb, so there is no duplicated request logic and a new REST endpoint
 *  needs zero edits here. `elowen_request` is the generic escape hatch (any endpoint works immediately);
 *  the typed helpers are thin fixed-route wrappers that exist only for nicer agent UX. */
export interface ElowenToolDeps { url: string; token: string; call?: typeof callElowenApi }

export function makeElowenTools(d: ElowenToolDeps) {
  const call = d.call ?? callElowenApi;
  const req = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const r = await call(method, path, body, { url: d.url, token: d.token });
    if (!r.ok) throw new Error(`elowen ${r.status}: ${r.text || JSON.stringify(r.data)}`);
    return r.data;
  };
  return {
    elowen_request: (a: { method: string; path: string; body?: unknown }) => req(a.method, a.path, a.body),
    elowen_tasks: () => req('GET', '/tasks'),
    elowen_create_task: (a: { title: string; project_id?: number; description?: string }) => req('POST', '/tasks', a),
    elowen_plan: (a: {
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
    elowen_sessions: () => req('GET', '/sessions'),
    elowen_note_add: (a: { target: string; body: string }) => req('POST', '/notes', { scope: 'mission', target: a.target, body: a.body }),
    elowen_notes: (a: { target: string }) => req('GET', `/notes?scope=mission&target=${encodeURIComponent(a.target)}`),
    // Mission lifecycle — engage spawns the autopilot on an epic; pause/resume/disengage drive its state.
    elowen_missions: () => req('GET', '/missions'),
    elowen_mission_engage: (a: { epicId: string; autonomy?: string; maxSessions?: number }) => req('POST', '/missions', a),
    elowen_mission_pause: (a: { id: string }) => req('PATCH', `/missions/${encodeURIComponent(a.id)}`, { action: 'pause' }),
    elowen_mission_resume: (a: { id: string }) => req('PATCH', `/missions/${encodeURIComponent(a.id)}`, { action: 'resume' }),
    elowen_mission_disengage: (a: { id: string }) => req('DELETE', `/missions/${encodeURIComponent(a.id)}`),
    // Live tmux session control — spawn a worker for a task, kill it, send keystrokes, read the pane.
    elowen_session_spawn: (a: { taskId: string; exec?: string }) => req('POST', '/sessions', a),
    elowen_session_kill: (a: { name: string }) => req('DELETE', `/sessions/${encodeURIComponent(a.name)}`),
    elowen_session_send_keys: (a: { name: string; keys: string[] }) => req('POST', `/sessions/${encodeURIComponent(a.name)}/keys`, { keys: a.keys }),
    elowen_session_read_pane: (a: { name: string; ansi?: boolean }) => req('GET', `/sessions/${encodeURIComponent(a.name)}/pane${a.ansi ? '?ansi=1' : ''}`),
    // Task lifecycle — update fields/status, close with an outcome verdict, read token/cost usage.
    elowen_task_update: (a: { id: string; status?: string; title?: string; type?: string; priority?: string; description?: string; exec?: string; deps?: string[] }) => {
      const { id, ...patch } = a;
      return req('PATCH', `/tasks/${encodeURIComponent(id)}`, patch);
    },
    elowen_task_close: (a: { id: string; result_summary?: string; outcome?: string }) =>
      req('PATCH', `/tasks/${encodeURIComponent(a.id)}`, { status: 'closed', result_summary: a.result_summary, outcome: a.outcome }),
    elowen_task_usage: (a: { id: string }) => req('GET', `/tasks/${encodeURIComponent(a.id)}/usage`),
  };
}
