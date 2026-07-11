import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteTransition } from '../../../components/shell/RouteTransition';
import { createWrapper } from '../../test-utils';

const navigation = vi.hoisted(() => ({ pathname: '/projects' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

describe('RouteTransition', () => {
  it('keeps exactly one incoming route tree through a rapid A → B → A navigation', () => {
    const { wrapper: Wrapper } = createWrapper();
    const view = render(<Wrapper><RouteTransition><span>projects-content</span></RouteTransition></Wrapper>);
    expect(screen.getByText('projects-content')).toBeInTheDocument();

    navigation.pathname = '/memory';
    view.rerender(<Wrapper><RouteTransition><span>memory-content</span></RouteTransition></Wrapper>);
    expect(screen.getByText('memory-content')).toBeInTheDocument();
    expect(screen.getAllByTestId('route-transition')).toHaveLength(1);

    navigation.pathname = '/projects';
    view.rerender(<Wrapper><RouteTransition><span>projects-returned</span></RouteTransition></Wrapper>);
    // Returning before the reveal finishes still replaces the tree instead of overlapping it.
    expect(screen.getByText('projects-returned')).toBeInTheDocument();
    expect(screen.getAllByTestId('route-transition')).toHaveLength(1);
  });
});
