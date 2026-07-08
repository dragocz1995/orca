import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TerminalWindow from '../../app/terminal/[name]/page';

vi.mock('next/navigation', () => ({ useParams: () => ({ name: 'elowen-advisor-1' }) }));
vi.mock('../../components/terminal/StreamTerminal', () => ({
  StreamTerminal: ({ name }: { name: string }) => <div data-testid="stream">{name}</div>,
}));

describe('TerminalWindow (pop-out route)', () => {
  it('renders a chromeless terminal for the routed session', async () => {
    render(<TerminalWindow />);
    expect((await screen.findByTestId('stream')).textContent).toBe('elowen-advisor-1'); // dynamic, ssr:false
    expect(screen.getByText('advisor-1')).toBeTruthy(); // header shows the friendly name
  });
});
