import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { makeOrcaTools } from './tools.js';

export interface McpDeps { url: string; token: string }

/** Build an MCP server exposing the Orca toolset bound to one caller's token. Every tool delegates to
 *  `makeOrcaTools` → the shared `callOrcaApi` core, so there is no request logic here to maintain. */
function createOrcaMcpServer(deps: McpDeps): McpServer {
  const tools = makeOrcaTools(deps);
  const server = new McpServer({ name: 'orca', version: '1.0.0' });
  const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data ?? null, null, 2) }] });

  server.registerTool('orca_request', {
    description: 'Call any Orca REST endpoint (full control). Generic escape hatch — every endpoint works without a dedicated tool.',
    inputSchema: { method: z.string(), path: z.string(), body: z.unknown().optional() },
  }, async (a) => text(await tools.orca_request({ method: a.method, path: a.path, body: a.body })));

  server.registerTool('orca_tasks', { description: 'List all tasks.', inputSchema: {} }, async () => text(await tools.orca_tasks()));

  server.registerTool('orca_create_task', {
    description: 'Create a task.',
    inputSchema: { title: z.string(), project_id: z.number().optional(), description: z.string().optional() },
  }, async (a) => text(await tools.orca_create_task(a)));

  server.registerTool('orca_plan', {
    description: 'Plan a goal into an epic with phases (autopilot). Supports full planning options: set engage:true to immediately start a mission; autonomy (L0-L3) controls agent freedom; maxSessions controls parallelism; exec overrides the executor; autoModel lets the planner pick per-phase models; dryRun previews phases without persisting; prompt supplies a custom planner prompt; prEnabled (true/false/null) controls PR-native mode.',
    inputSchema: {
      goal: z.string(),
      project_id: z.number().optional(),
      name: z.string().optional(),
      exec: z.string().optional(),
      autoModel: z.boolean().optional(),
      autonomy: z.string().optional(),
      maxSessions: z.number().optional(),
      engage: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      prompt: z.string().optional(),
      prEnabled: z.boolean().nullable().optional(),
    },
  }, async (a) => text(await tools.orca_plan(a)));

  server.registerTool('orca_sessions', { description: 'List live agent sessions.', inputSchema: {} }, async () => text(await tools.orca_sessions()));

  server.registerTool('orca_note_add', {
    description: 'Leave a handoff note for later agents working the same mission. `target` is the epic id.',
    inputSchema: { target: z.string(), body: z.string() },
  }, async (a) => text(await tools.orca_note_add(a)));

  server.registerTool('orca_notes', {
    description: "Read a mission's handoff notes left by earlier phases (oldest-first). `target` is the epic id.",
    inputSchema: { target: z.string() },
  }, async (a) => text(await tools.orca_notes(a)));

  // ---- Mission lifecycle ----
  server.registerTool('orca_missions', {
    description: 'List live missions (plus disengaged ones with a pending PR), each with its PR info.',
    inputSchema: {},
  }, async () => text(await tools.orca_missions()));

  server.registerTool('orca_mission_engage', {
    description: 'Engage the autopilot on an epic: spawn a mission that drives its phases to completion. `epicId` is required; autonomy (e.g. L0..L3) and maxSessions default server-side.',
    inputSchema: { epicId: z.string(), autonomy: z.string().optional(), maxSessions: z.number().optional() },
  }, async (a) => text(await tools.orca_mission_engage(a)));

  server.registerTool('orca_mission_pause', {
    description: 'Pause a running mission: kill its running agents, revert their tasks, then mark it paused. `id` is the mission id (e.g. `m-<epicId>`).',
    inputSchema: { id: z.string() },
  }, async (a) => text(await tools.orca_mission_pause(a)));

  server.registerTool('orca_mission_resume', {
    description: 'Resume a paused mission: flip it active, re-park the overseer, then tick. `id` is the mission id.',
    inputSchema: { id: z.string() },
  }, async (a) => text(await tools.orca_mission_resume(a)));

  server.registerTool('orca_mission_disengage', {
    description: 'Disengage (stop) a mission entirely, tearing down its agents. `id` is the mission id.',
    inputSchema: { id: z.string() },
  }, async (a) => text(await tools.orca_mission_disengage(a)));

  // ---- Live session control ----
  server.registerTool('orca_session_spawn', {
    description: 'Manually launch a worker agent for a task in a fresh tmux session. `taskId` is required; `exec` optionally overrides the executor (must be allowed).',
    inputSchema: { taskId: z.string(), exec: z.string().optional() },
  }, async (a) => text(await tools.orca_session_spawn(a)));

  server.registerTool('orca_session_kill', {
    description: 'Kill a live tmux session by name (e.g. `orca-<task>`).',
    inputSchema: { name: z.string() },
  }, async (a) => text(await tools.orca_session_kill(a)));

  server.registerTool('orca_session_send_keys', {
    description: 'Send key tokens to a session via tmux send-keys. `keys` is a non-empty array of plain tokens (e.g. ["Enter"], ["h","i"]); leading-dash tokens are rejected.',
    inputSchema: { name: z.string(), keys: z.array(z.string()) },
  }, async (a) => text(await tools.orca_session_send_keys(a)));

  server.registerTool('orca_session_read_pane', {
    description: "Capture the last ~60 lines of a session's pane. Set `ansi` to keep colour/escape codes; otherwise plain text.",
    inputSchema: { name: z.string(), ansi: z.boolean().optional() },
  }, async (a) => text(await tools.orca_session_read_pane(a)));

  // ---- Task lifecycle ----
  server.registerTool('orca_task_update', {
    description: 'Update a task: any of status (open/in_progress/blocked/closed/cancelled), title, type, priority, description, exec override, or deps. Only the fields you pass are changed.',
    inputSchema: {
      id: z.string(),
      status: z.enum(['open', 'in_progress', 'blocked', 'closed', 'cancelled']).optional(),
      title: z.string().optional(),
      type: z.string().optional(),
      priority: z.string().optional(),
      description: z.string().optional(),
      exec: z.string().optional(),
      deps: z.array(z.string()).optional(),
    },
  }, async (a) => text(await tools.orca_task_update(a)));

  server.registerTool('orca_task_close', {
    description: 'Close a task with a verdict: `result_summary` (what was done) and `outcome` (e.g. ok/fail). Drives the post-done overseer review gate for mission phases.',
    inputSchema: { id: z.string(), result_summary: z.string().optional(), outcome: z.string().optional() },
  }, async (a) => text(await tools.orca_task_close(a)));

  server.registerTool('orca_task_usage', {
    description: "Read a task's agent token/cost usage from the executor CLI's local session storage. Null usage means no matching session was found.",
    inputSchema: { id: z.string() },
  }, async (a) => text(await tools.orca_task_usage(a)));

  return server;
}

/** Stateless HTTP handler: a fresh server + transport per request, with the toolset bound to the
 *  request's bearer token, so each advisor connection acts with exactly its user's rights. */
export async function handleMcpRequest(req: Request, deps: McpDeps): Promise<Response> {
  const server = createOrcaMcpServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(req);
}
