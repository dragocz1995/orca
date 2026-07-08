import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { callElowenApi } from '../../shared/apiClient.js';

export interface ElowenToolCtx { url: string; token: string; fetchImpl?: typeof fetch }

/** Wrap a callElowenApi round-trip into the PI tool result shape. The raw JSON text is handed to the
 *  model — it reasons over it — so we return the API's own body verbatim (or a clear error line). */
async function call(ctx: ElowenToolCtx, method: string, path: string, body?: unknown) {
  const r = await callElowenApi(method, path, body, { url: ctx.url, token: ctx.token, fetchImpl: ctx.fetchImpl });
  const text = r.ok ? r.text : `Elowen API error HTTP ${r.status}: ${r.text}`;
  return { content: [{ type: 'text' as const, text }], details: {} };
}

export function elowenListTasks(ctx: ElowenToolCtx) {
  return defineTool({
    name: 'elowen_list_tasks', label: 'List tasks',
    description: 'List Elowen tasks, optionally filtered by project_id.',
    parameters: Type.Object({ project_id: Type.Optional(Type.Number()) }),
    execute: async (_id, p: { project_id?: number }) =>
      call(ctx, 'GET', p.project_id ? `/tasks?project_id=${p.project_id}` : '/tasks'),
  });
}

export function elowenCreateTask(ctx: ElowenToolCtx) {
  return defineTool({
    name: 'elowen_create_task', label: 'Create task',
    description: 'Create a new Elowen task in a project.',
    parameters: Type.Object({
      title: Type.String({ description: 'Task title' }),
      project_id: Type.Number({ description: 'Target project id' }),
      description: Type.Optional(Type.String()),
    }),
    execute: async (_id, p: { title: string; project_id: number; description?: string }) =>
      call(ctx, 'POST', '/tasks', p),
  });
}

export function elowenPlan(ctx: ElowenToolCtx) {
  return defineTool({
    name: 'elowen_plan', label: 'Plan a goal',
    description: 'Ask Elowen to break a goal into a task plan for a project.',
    parameters: Type.Object({ goal: Type.String(), project_id: Type.Number() }),
    execute: async (_id, p: { goal: string; project_id: number }) => call(ctx, 'POST', '/tasks/plan', p),
  });
}

export function elowenListMissions(ctx: ElowenToolCtx) {
  return defineTool({
    name: 'elowen_list_missions', label: 'List missions',
    description: 'List Elowen autopilot missions.',
    parameters: Type.Object({}),
    execute: async () => call(ctx, 'GET', '/missions'),
  });
}

export function elowenListSessions(ctx: ElowenToolCtx) {
  return defineTool({
    name: 'elowen_list_sessions', label: 'List sessions',
    description: 'List live Elowen agent sessions.',
    parameters: Type.Object({}),
    execute: async () => call(ctx, 'GET', '/sessions'),
  });
}
