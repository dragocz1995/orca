import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import SettingsPage from '../../app/settings/page';
import { ToastProvider } from '../../components/ui/Toast';
import { createWrapper } from '../test-utils';

let putBody: any = null;
const server = setupServer(
  http.get('*/config', () => HttpResponse.json({ allowedExecs: ['sonnet', 'codex:gpt-5.4'], autopilot: { model: 'mimo-v2.5', apiUrl: 'https://ai.coresynth.io/v1', apiKeySet: false } })),
  http.put('*/config', async ({ request }) => { putBody = await request.json(); return HttpResponse.json({ allowedExecs: ['sonnet'], autopilot: { model: 'mimo-v2.5', apiUrl: 'https://ai.coresynth.io/v1', apiKeySet: false } }); }),
);
beforeAll(() => server.listen()); afterAll(() => server.close());

describe('SettingsPage', () => {
  it('loads config and saves a changed model allowlist', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><ToastProvider><SettingsPage /></ToastProvider></Wrapper>);
    await waitFor(() => expect(screen.getByLabelText('Claude Sonnet')).toBeChecked());
    fireEvent.click(screen.getByLabelText('Claude Sonnet')); // uncheck sonnet
    fireEvent.click(screen.getByRole('button', { name: 'Save models' }));
    await waitFor(() => expect(putBody.allowedExecs).not.toContain('sonnet'));
  });
});
