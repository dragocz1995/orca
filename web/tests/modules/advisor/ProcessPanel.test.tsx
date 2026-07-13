import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { onUnhandledRequest } from '../../msw';
import { createWrapper } from '../../test-utils';
import { ProcessPanel } from '../../../modules/advisor/ProcessPanel';
import type { ProcessInfo } from '../../../lib/types';

const proc = (id: string, command: string, sessionId: string | null): ProcessInfo => ({
  id, command, cwd: '/w', startedAt: '2026-01-01T00:00:00Z', sessionId, running: true, exitCode: null,
});

// The sessionless list spans EVERY process the operator owns, so a row can come from a sub-agent child,
// another channel, or one of the operator's OTHER chats — the panel labels every such origin and can kill
// them from here (the only surface that can reach a service process an orphaned delegate left behind).
const processes: ProcessInfo[] = [
  proc('own', 'npm run dev', 'brain-1'),
  proc('other', 'python train.py', 'brain-7'),
  proc('sub', 'npm run watch', 'brain-ch-subagent-sub-dlg-9'),
  proc('chan', 'tail -f log', 'brain-ch-discord-42'),
];
const killed: string[] = [];
const server = setupServer(
  http.get('*/api/brain/processes', () => HttpResponse.json(processes)),
  http.delete('*/api/brain/processes/:id', ({ params }) => { killed.push(String(params['id'])); return HttpResponse.json({ killed: true }); }),
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => { server.resetHandlers(); killed.length = 0; });
afterAll(() => server.close());

describe('ProcessPanel', () => {
  it('badges every process that the open conversation did not start', async () => {
    const { wrapper } = createWrapper();
    render(<ProcessPanel activeSessionId="brain-1" />, { wrapper });

    const own = await screen.findByTitle('npm run dev');
    const sub = await screen.findByTitle('npm run watch');
    const chan = await screen.findByTitle('tail -f log');
    const other = await screen.findByTitle('python train.py');
    // Origin badges sit next to the command, carrying the raw session id in their title.
    expect(sub.parentElement?.textContent).toContain('sub-agent');
    expect(screen.getByTitle('brain-ch-subagent-sub-dlg-9').textContent).toBe('sub-agent');
    expect(chan.parentElement?.textContent).toContain('channel');
    expect(screen.getByTitle('brain-ch-discord-42').textContent).toBe('channel');
    // The list is owner-wide, so the user's OTHER chat shows up here too — and it must be marked as such.
    // Unbadged has exactly one meaning: this conversation started it (and its ✕ kills something local).
    expect(other.parentElement?.textContent).toContain('other chat');
    expect(screen.getByTitle('brain-7').textContent).toBe('other chat');
    expect(own.parentElement?.textContent).toBe('●npm run dev');
  });

  it('follows the conversation on screen: the same row is local in one chat and foreign in another', async () => {
    const { wrapper } = createWrapper();
    const { unmount } = render(<ProcessPanel activeSessionId="brain-7" />, { wrapper });

    // Viewing brain-7 flips the two plain-conversation rows: its own process loses the badge, and the one
    // from brain-1 gains it. A badge that ignored the open conversation could not do both.
    expect((await screen.findByTitle('python train.py')).parentElement?.textContent).toBe('●python train.py');
    expect((await screen.findByTitle('npm run dev')).parentElement?.textContent).toContain('other chat');
    unmount();
  });

  it('kills a sub-agent process straight from the panel', async () => {
    const { wrapper } = createWrapper();
    render(<ProcessPanel activeSessionId="brain-1" />, { wrapper });
    const row = (await screen.findByTitle('npm run watch')).parentElement!;

    fireEvent.click(within(row).getByRole('button', { name: 'Kill process' }));

    await waitFor(() => expect(killed).toEqual(['sub']));
  });
});
