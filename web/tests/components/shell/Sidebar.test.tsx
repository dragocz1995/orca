import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('next/navigation', () => ({ usePathname: () => '/dash' }));
import { Sidebar } from '../../../components/shell/Sidebar';

describe('Sidebar', () => {
  it('marks the active route with the accent underline class', () => {
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: 'Dash' }).className).toContain('border-accent');
    expect(screen.getByRole('link', { name: 'Tasks' }).className).not.toContain('border-accent');
  });
});
