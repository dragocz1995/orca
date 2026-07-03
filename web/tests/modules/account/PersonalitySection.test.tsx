import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor, renderHook, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PersonalitySection, activePersonalityId } from '../../../modules/account/PersonalitySection';
import { useActivatePersonality } from '../../../lib/mutations';
import { ToastProvider } from '../../../components/ui/Toast';
import { createWrapper } from '../../test-utils';
import type { PersonalityProfile } from '../../../lib/types';

// Monaco is browser-only (web workers) and never mounts in these list/switch tests; stub it so the
// dynamic import doesn't try to load the real editor under jsdom.
vi.mock('../../../modules/projects/editor/monacoLoader', () => ({
  MonacoEditor: () => null,
  MonacoDiffEditor: () => null,
}));

const profile = (over: Partial<PersonalityProfile>): PersonalityProfile => ({
  id: 1, user_id: 1, platform: 'web', name: 'Web persona', description: '', tone: '', style: '', prompt: 'Be helpful.',
  enabled: true, created_at: '', updated_at: '', ...over,
});

const byPlatform: Record<string, PersonalityProfile[]> = {
  web: [profile({ id: 1, platform: 'web', name: 'Web persona' })],
  discord: [profile({ id: 2, platform: 'discord', name: 'Discord persona' })],
  cli: [],
};

const server = setupServer(
  http.get('*/api/personality/profiles', ({ request }) => {
    const platform = new URL(request.url).searchParams.get('platform') ?? 'web';
    return HttpResponse.json(byPlatform[platform] ?? []);
  }),
  http.post('*/api/personality/preview', async ({ request }) => {
    const { platform } = (await request.json()) as { platform: string };
    return HttpResponse.json({ platform, layers: [{ label: 'Core persona', text: 'core' }, { label: `User personality (${platform})`, text: 'no active profile' }], resolved: 'core' });
  }),
  http.post('*/api/personality/profiles/:id/activate', ({ params }) => HttpResponse.json(profile({ id: Number(params.id) })),
  ),
);
beforeAll(() => server.listen()); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

describe('activePersonalityId', () => {
  it('matches the active profile from the preview append layer', () => {
    const profiles = [profile({ id: 1, name: 'A', prompt: 'Alpha.' }), profile({ id: 2, name: 'B', prompt: 'Beta.' })];
    const preview = { platform: 'web', layers: [{ label: 'Core', text: 'core' }, { label: 'User', text: 'User personality for web:\nName: B\n\nInstructions:\nBeta.' }], resolved: 'x' };
    expect(activePersonalityId(profiles, preview)).toBe(2);
  });
  it('returns null when no active profile', () => {
    const profiles = [profile({ id: 1, name: 'A', prompt: 'Alpha.' })];
    expect(activePersonalityId(profiles, { platform: 'web', layers: [{ label: 'c', text: 'core' }, { label: 'u', text: 'no active profile' }], resolved: 'core' })).toBeNull();
  });
});

describe('PersonalitySection', () => {
  it('shows a platform\'s profiles and switches platform', async () => {
    const { wrapper } = createWrapper();
    render(<ToastProvider><PersonalitySection /></ToastProvider>, { wrapper });

    expect(await screen.findByText('Web persona')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Discord' }));
    expect(await screen.findByText('Discord persona')).toBeInTheDocument();
    expect(screen.queryByText('Web persona')).not.toBeInTheDocument();
  });
});

describe('useActivatePersonality', () => {
  it('invalidates profiles and preview on success', async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useActivatePersonality(), { wrapper });
    result.current.mutate(2);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['personalities'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['personality-preview'] });
  });
});
