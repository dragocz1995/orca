import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from '../../../components/ui/StatCard';
import { Toolbar } from '../../../components/ui/Toolbar';

describe('StatCard + Toolbar', () => {
  it('StatCard shows label + mono value + hint', () => {
    render(<StatCard label="Tasks" value={7} hint="open" />);
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('7')).toHaveClass('font-mono');
    expect(screen.getByText('open')).toBeInTheDocument();
  });
  it('Toolbar renders its children', () => {
    render(<Toolbar><button>f</button></Toolbar>);
    expect(screen.getByRole('button', { name: 'f' })).toBeInTheDocument();
  });
});
