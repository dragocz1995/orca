import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
const pushSpy = vi.hoisted(() => vi.fn());
const currentPath = vi.hoisted(() => ({ value: '/stats' }));
vi.mock('next/navigation', () => ({ usePathname: () => currentPath.value, useRouter: () => ({ push: pushSpy }) }));
import { getStableOffsets, OrbitalNav, railSpacing } from '../../../components/shell/OrbitalNav';
import { createWrapper } from '../../test-utils';

function mount(compact = false) {
  const { wrapper: Wrapper, client } = createWrapper();
  client.setQueryData(['me'], { user: { id: 1, username: 'admin', is_admin: true } });
  client.setQueryData(['health'], { ok: true, version: '0.26.0' });
  return render(<Wrapper><OrbitalNav compact={compact} /></Wrapper>);
}

/** The vertical offset a rail item is parked at, e.g. `translate(0, calc(-50% + -66px)) scale(.9)` → -66. */
function offsetOf(label: string): number {
  const style = screen.getByRole('link', { name: label }).closest('[role="listitem"]')!.getAttribute('style') ?? '';
  const match = /calc\(-50% \+ (-?[\d.]+)px\)/.exec(style);
  if (!match) throw new Error(`no offset in style: ${style}`);
  return Number(match[1]);
}

describe('getStableOffsets', () => {
  it('parks the rail in one fixed, centered visual order', () => {
    expect(getStableOffsets(8, 66)).toEqual([-231, -165, -99, -33, 33, 99, 165, 231]);
  });
});

describe('railSpacing', () => {
  it('uses the public rail spacing whenever the axis has room for it', () => {
    expect(railSpacing(12, 1000)).toBe(66);
    expect(railSpacing(8, 845)).toBe(66);
  });

  it('tightens rather than clipping the end destinations on a short axis', () => {
    const stage = 704; // an 800px-tall window
    const spacing = railSpacing(12, stage);
    expect(spacing).toBeLessThan(66);
    // Every node, including the outermost, must still sit inside the axis.
    const offsets = getStableOffsets(12, spacing);
    expect(Math.abs(offsets[0]) + 40).toBeLessThanOrEqual(stage / 2);
  });

  it('falls back to the public spacing before the axis has been measured', () => {
    expect(railSpacing(12, 0)).toBe(66);
  });
});

describe('OrbitalNav rail stability', () => {
  it('keeps every destination at the same offset whichever route is active', () => {
    currentPath.value = '/stats';
    const first = mount();
    const parked = ['Projects', 'Editor', 'Stats', 'Memory', 'Users', 'Home'].map((l) => [l, offsetOf(l)] as const);
    first.unmount();

    // Navigating must not re-shuffle the rail: an item's parked offset is a property of the rail's
    // order, not of which item happens to be active — otherwise items slide past each other on every
    // route change, and the one wrapping the ends jumps with no transition at all.
    currentPath.value = '/users';
    mount();
    for (const [label, offset] of parked) expect([label, offsetOf(label)]).toEqual([label, offset]);
  });

  it('does not wrap the wheel around the ends of the rail', () => {
    currentPath.value = '/dash'; // last route on the axis
    mount();
    pushSpy.mockClear();
    fireEvent.wheel(screen.getByTestId('future-navigation'), { deltaY: 60 });
    expect(pushSpy).not.toHaveBeenCalled(); // clamped, never wrapped back to the first route
  });
});

describe('OrbitalNav', () => {
  beforeEach(() => { currentPath.value = '/stats'; });

  it('exposes work and project destinations as top-level orbital links', () => {
    mount();
    expect(screen.getByTestId('future-navigation').querySelector('canvas')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Elowen' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks');
    expect(screen.getByRole('link', { name: 'Kanban' })).toHaveAttribute('href', '/kanban');
    expect(screen.getByRole('link', { name: 'Sessions' })).toHaveAttribute('href', '/sessions');
    expect(screen.getByRole('link', { name: 'Timeline' })).toHaveAttribute('href', '/timeline');
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Editor' })).toHaveAttribute('href', '/editor');
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users');
    expect(screen.queryByRole('link', { name: 'Work' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'System' })).toBeNull();
  });

  it('keeps a link stable under the pointer so one click can navigate', () => {
    mount();
    const projects = screen.getByRole('link', { name: 'Projects' });
    const before = projects.closest('[role="listitem"]')?.getAttribute('style');
    fireEvent.focus(projects);
    expect(projects.closest('[role="listitem"]')?.getAttribute('style')).toBe(before);
    expect(projects).toHaveAttribute('href', '/projects');
  });

  it('steps to the next route when the wheel is used over navigation', () => {
    mount();
    fireEvent.wheel(screen.getByTestId('future-navigation'), { deltaY: 60 });
    expect(pushSpy).toHaveBeenCalledWith('/memory');
  });

  it('renders the scroll cue above the version', () => {
    mount();
    expect(screen.getByText('SCROLL')).toBeInTheDocument();
    expect(screen.getByText('v0.26.0')).toBeInTheDocument();
  });

  it('keeps every destination on one vertical orbital rail', () => {
    mount();
    const users = screen.getByRole('link', { name: 'Users' });
    expect(users).not.toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('future-navigation')).toHaveClass('w-[17rem]');
    expect(users.closest('[role="listitem"]')).toHaveClass('absolute');
    const origins = screen.getAllByRole('listitem').map((item) => item.style.transformOrigin);
    expect(new Set(origins)).toEqual(new Set(['2.5rem center']));
  });

  it('does not move controls under the pointer', () => {
    mount();
    const projects = screen.getByRole('link', { name: 'Projects' }).closest('[role="listitem"]');
    const before = projects?.className;
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Projects' }));
    expect(projects?.className).toBe(before);
  });

  it('collapses to an icon orbit when content room is constrained', () => {
    mount(true);
    expect(screen.getByTestId('future-navigation')).toHaveClass('w-[4.75rem]');
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('aria-current', 'page');
  });
});
