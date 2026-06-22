import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { onUnhandledRequest } from '../../msw';
import { EscalationsView } from '../../../modules/escalations/EscalationsView';
import { ToastProvider } from '../../../components/ui/Toast';
import { createWrapper } from '../../test-utils';

let patched: { id: string; body: unknown }[] = [];
const server = setupServer(
  http.patch('*/api/tasks/:id', async ({ params, request }) => { patched.push({ id: String(params.id), body: await request.json() }); return HttpResponse.json({ ok: true }); }),
  http.patch('*/api/missions/:id', () => HttpResponse.json({ ok: true })),
);
beforeAll(() => server.listen({ onUnhandledRequest })); afterEach(() => { server.resetHandlers(); patched = []; }); afterAll(() => server.close());

function seed(client: ReturnType<typeof createWrapper>['client']) {
  client.setQueryData(['activity', 'review'], [
    { id: 2, ts: '2026-06-22 10:00:00', type: 'review', target: 'p1', detail: 'escalated: summary claims a fix that is not in the diff', project_id: 1, label: 'Audit docs' },
  ]);
  client.setQueryData(['tasks'], [
    { id: 'p1', title: 'Audit docs', status: 'closed', parent_id: 'epic1' },
    { id: 'p2', title: 'Fix auth', status: 'blocked', parent_id: 'epic1' },
  ]);
  client.setQueryData(['tasks', 'deps'], [{ task_id: 'p2', depends_on_id: 'p1' }]);
}

describe('EscalationsView', () => {
  it('shows the overseer rationale, the rejected phase and the blocked dependent', () => {
    const { wrapper: Wrapper, client } = createWrapper();
    seed(client);
    render(<Wrapper><ToastProvider><EscalationsView /></ToastProvider></Wrapper>);
    expect(screen.getByText('Audit docs')).toBeTruthy();
    expect(screen.getByText(/summary claims a fix that is not in the diff/)).toBeTruthy();
    expect(screen.getByText('Fix auth')).toBeTruthy(); // the blocked dependent
  });

  it('re-run re-opens the rejected phase', async () => {
    const { wrapper: Wrapper, client } = createWrapper();
    seed(client);
    render(<Wrapper><ToastProvider><EscalationsView /></ToastProvider></Wrapper>);
    fireEvent.click(screen.getByText('Re-run phase'));
    await waitFor(() => expect(patched.some((p) => p.id === 'p1' && (p.body as { status?: string }).status === 'open')).toBe(true));
  });

  it('approve re-opens the blocked dependent', async () => {
    const { wrapper: Wrapper, client } = createWrapper();
    seed(client);
    render(<Wrapper><ToastProvider><EscalationsView /></ToastProvider></Wrapper>);
    fireEvent.click(screen.getByText('Approve & continue'));
    await waitFor(() => expect(patched.some((p) => p.id === 'p2' && (p.body as { status?: string }).status === 'open')).toBe(true));
  });

  it('renders an empty state when nothing is escalated', () => {
    const { wrapper: Wrapper, client } = createWrapper();
    client.setQueryData(['activity', 'review'], []);
    client.setQueryData(['tasks'], []);
    client.setQueryData(['tasks', 'deps'], []);
    render(<Wrapper><ToastProvider><EscalationsView /></ToastProvider></Wrapper>);
    expect(screen.getByText('No escalations')).toBeTruthy();
  });
});
