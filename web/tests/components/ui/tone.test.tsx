import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatCard } from '../../../components/ui/StatCard';
import { Badge } from '../../../components/ui/Badge';

describe('Tone on primitives', () => {
  it('StatCard renders a danger value with the danger token class', () => {
    const { getByText } = render(<StatCard label="Blocked" value={3} tone="danger" />);
    expect(getByText('3').className).toContain('text-danger');
  });
  it('StatCard renders a muted value', () => {
    const { getByText } = render(<StatCard label="Closed" value={5} tone="muted" />);
    expect(getByText('5').className).toContain('text-text-muted');
  });
  it('Badge renders a danger tone', () => {
    const { getByText } = render(<Badge tone="danger">blocked</Badge>);
    expect(getByText('blocked').className).toContain('danger');
  });
});
