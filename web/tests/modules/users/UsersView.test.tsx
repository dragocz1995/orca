import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { onUnhandledRequest } from '../../msw';
import { UsersView } from '../../../modules/users/UsersView';
import { ToastProvider } from '../../../components/ui/Toast';
import { createWrapper } from '../../test-utils';

const server = setupServer(
  http.get('*/users', () => HttpResponse.json([
    { id: 1, username: 'alice', created_at: '2026-01-01', is_admin: false, allowed_execs: [] },
    { id: 2, username: 'bob', created_at: '2026-01-02', is_admin: false, allowed_execs: [] },
  ])),
);
beforeAll(() => server.listen({ onUnhandledRequest })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

describe('UsersView', () => {
  it('lists users from the API', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><UsersView /></ToastProvider></Wrapper>);
    expect(await screen.findByText('alice')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
  });

  it('admin sees role badges + model chips and can restrict a user to a model', async () => {
    let patched: { id?: string; body?: unknown } = {};
    server.use(
      http.get('*/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'alice', created_at: '2026-01-01', is_admin: true, allowed_execs: [] } })),
      http.get('*/config', () => HttpResponse.json({ allowedExecs: ['sonnet', 'codex:gpt-5.4'], customModels: [], hiddenPresets: [], autopilot: {}, providers: {}, defaults: {} })),
      http.get('*/users', () => HttpResponse.json([
        { id: 1, username: 'alice', created_at: '2026-01-01', is_admin: true, allowed_execs: [] },
        { id: 2, username: 'bob', created_at: '2026-01-02', is_admin: false, allowed_execs: [] },
      ])),
      http.get('*/users/:id/projects', () => HttpResponse.json([])),
      http.patch('*/users/:id', async ({ params, request }) => { patched = { id: String(params.id), body: await request.json() }; return HttpResponse.json({ id: 2, username: 'bob', is_admin: false, allowed_execs: ['sonnet'] }); }),
    );
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><UsersView /></ToastProvider></Wrapper>);

    // Admin (alice) carries an Admin badge; both users expose the allowed-models picker.
    expect(await screen.findByText('Admin')).toBeTruthy();
    const bobRow = (await screen.findByText('bob')).closest('li')!;
    const sonnetChip = within(bobRow).getByRole('button', { name: /Claude Sonnet/ });
    fireEvent.click(sonnetChip);

    // Toggling the chip PATCHes that user's allowed_execs.
    await waitFor(() => expect(patched.id).toBe('2'));
    expect((patched.body as { allowed_execs: string[] }).allowed_execs).toEqual(['sonnet']);
  });
});
