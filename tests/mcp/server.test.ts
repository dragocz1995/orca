import { describe, it, expect } from 'vitest';
import { handleMcpRequest } from '../../src/mcp/server.js';

/** A minimal MCP `initialize` JSON-RPC request — enough to prove the server stands up, advertises the
 *  elowen server, and responds without error. The tool layer itself is covered by tools.test.ts. */
function initRequest(): Request {
  return new Request('http://localhost:4400/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
    }),
  });
}

describe('handleMcpRequest', () => {
  it('responds 200 to an initialize handshake and names the elowen server', async () => {
    const res = await handleMcpRequest(initRequest(), { url: 'http://localhost:4400', token: 'tok' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('elowen');           // serverInfo.name
    expect(body).toContain('protocolVersion'); // a real initialize result
  });

  it('tools/list returns all 19 elowen tools (SSE transport)', async () => {
    const req = new Request('http://localhost:4400/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const res = await handleMcpRequest(req, { url: 'http://localhost:4400', token: 'tok' });
    expect(res.status).toBe(200);
    const body = await res.text();
    // SSE response — extract the JSON payload from the "data:" line
    const dataLine = body.split('\n').find((l) => l.startsWith('data:'));
    expect(dataLine).toBeTruthy();
    const parsed = JSON.parse(dataLine!.replace(/^data:\s*/, ''));
    const names = parsed.result?.tools?.map((t: { name: string }) => t.name) ?? [];
    expect(names).toContain('elowen_request');
    expect(names).toContain('elowen_tasks');
    expect(names).toContain('elowen_create_task');
    expect(names).toContain('elowen_plan');
    expect(names).toContain('elowen_sessions');
    expect(names).toContain('elowen_note_add');
    expect(names).toContain('elowen_notes');
    expect(names).toContain('elowen_missions');
    expect(names).toContain('elowen_mission_engage');
    expect(names).toContain('elowen_mission_pause');
    expect(names).toContain('elowen_mission_resume');
    expect(names).toContain('elowen_mission_disengage');
    expect(names).toContain('elowen_session_spawn');
    expect(names).toContain('elowen_session_kill');
    expect(names).toContain('elowen_session_send_keys');
    expect(names).toContain('elowen_session_read_pane');
    expect(names).toContain('elowen_task_update');
    expect(names).toContain('elowen_task_close');
    expect(names).toContain('elowen_task_usage');
    expect(names).toHaveLength(19);
  });
});
