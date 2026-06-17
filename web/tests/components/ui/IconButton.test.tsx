import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { X } from 'lucide-react';
import { IconButton } from '../../../components/ui/IconButton';

describe('IconButton', () => {
  it('renders with aria-label and fires onClick', () => {
    const onClick = vi.fn();
    render(<IconButton icon={X} label="Close" onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
  it('disabled blocks onClick', () => {
    const onClick = vi.fn();
    render(<IconButton icon={X} label="Close" onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
