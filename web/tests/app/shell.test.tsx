import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { onUnhandledRequest } from '../msw';
vi.mock('next/navigation', () => ({ usePathname: () => '/dash', useRouter: () => ({ push: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams() }));
import { Shell, resolveNav } from '../../components/shell/Shell';

class FakeES { onmessage = null; addEventListener() {} close() {} constructor(public url: string) {} }
(globalThis as unknown as { EventSource: typeof FakeES }).EventSource = FakeES;
const server = setupServer(
  http.get('*/api/health', () => HttpResponse.json({ ok: true })),
  // A valid session: LoginGate's me() probe resolves → the shell chrome renders.
  http.get('*/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'admin' } })),
);
beforeAll(() => server.listen({ onUnhandledRequest })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

// Width sets a floor on how compact the chrome may be; the user's pin may only go compacter than the
// floor, never roomier. The handle is therefore offered exactly when the pin is what decides — anywhere
// else it would be a control that cannot change anything.
describe('resolveNav', () => {
  it('hands a roomy window to the user: their pin decides, and they get the handle to set it', () => {
    expect(resolveNav(1600, 'full')).toEqual({ mode: 'full', pinnable: true });
    expect(resolveNav(1600, 'rail')).toEqual({ mode: 'rail', pinnable: true });
  });

  it('forces the icon rail when the window is too narrow for the full one, offering no dead handle', () => {
    expect(resolveNav(1000, 'full')).toEqual({ mode: 'rail', pinnable: false });
    expect(resolveNav(1000, 'rail')).toEqual({ mode: 'rail', pinnable: false });
  });

  it('falls back to the hamburger drawer on a phone-narrow region', () => {
    expect(resolveNav(600, 'rail')).toEqual({ mode: 'drawer', pinnable: false });
  });

  it('shows no handle before the region has been measured, so none flashes on first paint', () => {
    expect(resolveNav(0, 'rail')).toEqual({ mode: 'full', pinnable: false });
  });
});

describe('Shell', () => {
  it('renders the orbital desktop navigation, frameless masthead and content slot', async () => {
    render(<Shell><span>page-body</span></Shell>);
    // The orbital navigation and Home world appear after the async gate opens.
    expect(await screen.findByTestId('future-navigation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('page-body')).toBeInTheDocument();
    expect(screen.getByTestId('future-page-header')).not.toHaveClass('sticky');
    expect(screen.getByTestId('future-page-header')).not.toHaveClass('border-b');
  });
});
