import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { createWrapper } from '../test-utils';
import { ToastProvider } from '../../components/ui/Toast';
import type { BrainModelOption } from '../../lib/types';

// A controllable EventSource stand-in: counts constructions (a model switch must open NO new stream) and
// lets a test dispatch a server-pushed `session-event` to the registered listener.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  private listeners = new Map<string, (e: unknown) => void>();
  close = vi.fn();
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this); }
  addEventListener(type: string, handler: (e: unknown) => void): void { this.listeners.set(type, handler); }
  emit(type: string, data: string): void { this.listeners.get(type)?.({ data } as unknown); }
}
vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);

const brainStart = vi.fn(async () => ({ sessionId: 'brain-1' }));
// The live chat boots + refetches history through the PAGED endpoint (brainMessagesPage); brainMessages
// (bare) is only the read-only path, unused here but kept so the mock matches the client surface.
const brainMessagesPage = vi.fn(async () => ({ items: [], hasMore: false, nextBefore: null }));
const brainMessages = vi.fn(async () => []);
const brainStatus = vi.fn(async () => ({ running: true, sessionId: 'brain-1', model: 'model-a', usage: null, statusline: null }));
const brainSetModel = vi.fn(async () => ({ model: 'model-b' }));
vi.mock('../../lib/elowenClient', () => ({
  BASE: '/api',
  elowenClient: {
    brainStart: (...a: unknown[]) => brainStart(...(a as [])),
    brainMessagesPage: (...a: unknown[]) => brainMessagesPage(...(a as [])),
    brainMessages: (...a: unknown[]) => brainMessages(...(a as [])),
    brainStatus: (...a: unknown[]) => brainStatus(...(a as [])),
    brainSetModel: (...a: unknown[]) => brainSetModel(...(a as [])),
    brainModels: async () => [],
    brainCommands: async () => ({ commands: [] }),
    brainSessions: async () => [],
  },
}));

import { BrainChatProvider, useBrainChat } from '../../modules/advisor/BrainChatProvider';

const FIX_MODEL: BrainModelOption = {
  provider: 'p', providerLabel: 'P', model: 'model-b', exec: 'elowen:p/model-b',
  source: 'oauth', contextWindow: 200_000, contextWindowSet: true,
};

function Harness() {
  const c = useBrainChat();
  useEffect(() => { c.ensureAttached(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <span data-testid="turns">{c.turns.length}</span>
      <span data-testid="draft">{c.input}</span>
      <span data-testid="hasMore">{c.hasMoreHistory ? 'yes' : 'no'}</span>
      <button onClick={() => c.setInput('unsent draft')}>type</button>
      <button onClick={() => c.setModel(FIX_MODEL)}>switch</button>
      <button onClick={() => { void c.loadOlder(); }}>older</button>
    </div>
  );
}

const renderChat = () =>
  render(
    <ToastProvider><BrainChatProvider><Harness /></BrainChatProvider></ToastProvider>,
    { wrapper: createWrapper().wrapper },
  );

beforeEach(() => {
  FakeEventSource.instances.length = 0;
  vi.clearAllMocks();
});

describe('BrainChatProvider model-switch reconcile', () => {
  it('switches the model without tearing down / reopening the SSE, and the pushed session-event refetches history once with no duplicate turn', async () => {
    renderChat();
    // Initial connect: exactly one stream, one history load.
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await waitFor(() => expect(brainMessagesPage).toHaveBeenCalledTimes(1));

    // A model switch: it hits POST /brain/model but opens NO new EventSource and does NOT reload history
    // (the reconcile arrives over the still-open stream).
    await act(async () => { fireEvent.click(screen.getByText('switch')); });
    await waitFor(() => expect(brainSetModel).toHaveBeenCalledTimes(1));
    expect(FakeEventSource.instances).toHaveLength(1); // no SSE teardown/reopen — invariant 1
    expect(brainMessagesPage).toHaveBeenCalledTimes(1); // runModel never reloads history

    // The daemon pushes the reconcile on the SAME stream: exactly one history refetch, and no fabricated
    // 'user' turn (session-event is not a transcript reset).
    await act(async () => { FakeEventSource.instances[0]!.emit('session-event', '{}'); });
    await waitFor(() => expect(brainMessagesPage).toHaveBeenCalledTimes(2));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(screen.getByTestId('turns').textContent).toBe('0'); // no duplicate/extra turn
  });

  it('an idle rollover (session event) closes the lazy-load window so a stale cursor cannot re-page the new session', async () => {
    // Boot with an open window (more history remains, cursor mid-stream).
    brainMessagesPage.mockResolvedValueOnce({ items: [{ id: 'm1', role: 'user', text: 'q' }], hasMore: true, nextBefore: 1 });
    renderChat();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('hasMore').textContent).toBe('yes'));
    const pagedCalls = brainMessagesPage.mock.calls.length;

    // The daemon rolls the idle conversation into a fresh one on the SAME stream.
    await act(async () => { FakeEventSource.instances[0]!.emit('session', JSON.stringify({ sessionId: 'brain-2' })); });
    expect(screen.getByTestId('hasMore').textContent).toBe('no'); // window closed → no scroll-up sentinel

    // A scroll-up now must be a no-op: the cursor was reset to null, so loadOlder never re-pages (which would
    // otherwise double the rolled-over session's just-shown turns).
    await act(async () => { fireEvent.click(screen.getByText('older')); });
    expect(brainMessagesPage.mock.calls.length).toBe(pagedCalls);
  });

  it('a header/dock model switch preserves the composer draft (never wipes unsent text)', async () => {
    renderChat();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    // The user types but has not sent, then changes model from the header picker.
    await act(async () => { fireEvent.click(screen.getByText('type')); });
    expect(screen.getByTestId('draft').textContent).toBe('unsent draft');
    await act(async () => { fireEvent.click(screen.getByText('switch')); });
    await waitFor(() => expect(brainSetModel).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('draft').textContent).toBe('unsent draft'); // draft survives the switch
  });
});
