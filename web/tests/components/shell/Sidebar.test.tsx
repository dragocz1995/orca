import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
vi.mock('next/navigation', () => ({ usePathname: () => '/dash' }));
import { Sidebar } from '../../../components/shell/Sidebar';
import { createWrapper } from '../../test-utils';

const server = setupServer(http.get('http://localhost:4400/health', () => HttpResponse.json({ ok: true })));
beforeAll(() => server.listen()); afterAll(() => server.close());
beforeEach(() => localStorage.clear());

describe('Sidebar', () => {
  it('renders wordmark, groups, active item, and the collapse toggle', () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><Sidebar /></Wrapper>);
    expect(screen.getByText('Orca')).toBeInTheDocument();
    expect(screen.getByText('Operate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Dash/ }).className).toContain('border-accent');
    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument();
  });
  it('collapse toggle hides labels', () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><Sidebar /></Wrapper>);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(screen.queryByText('Operate')).not.toBeInTheDocument();
  });
  it('health dot label is announced via status span once health resolves', async () => {
    const { wrapper: Wrapper } = createWrapper();
    render(<Wrapper><Sidebar /></Wrapper>);
    // Wait for the async health query to resolve to ok=true
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'daemon up' })).toBeInTheDocument();
    });
  });
  it('on mobile (max-width 767px) group labels are hidden (icon-rail)', async () => {
    // Stub matchMedia to report mobile (matches: true)
    const mobileMediaQuery = {
      matches: true,
      media: '(max-width: 767px)',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mobileMediaQuery));

    const { wrapper: Wrapper } = createWrapper();
    await act(async () => {
      render(<Wrapper><Sidebar /></Wrapper>);
    });

    // In mobile icon-rail mode the NavGroup labels are hidden
    expect(screen.queryByText('Operate')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
