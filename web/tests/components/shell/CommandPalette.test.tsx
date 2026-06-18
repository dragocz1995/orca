import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: () => {} }) }));
import { CommandPalette } from '../../../components/shell/CommandPalette';

describe('CommandPalette', () => {
  it('opens on Ctrl+K, filters, and runs a command on Enter', () => {
    render(<CommandPalette />);
    // closed initially
    expect(screen.queryByPlaceholderText('Search commands…')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByPlaceholderText('Search commands…');
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'kanban' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/kanban');
  });
});
