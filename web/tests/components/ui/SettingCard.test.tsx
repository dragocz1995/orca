import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingCard } from '../../../components/ui/SettingCard';

describe('SettingCard', () => {
  it('renders title, description and control slot', () => {
    render(<SettingCard title="Models" description="Enabled executors"><button>ctrl</button></SettingCard>);
    expect(screen.getByText('Models')).toBeTruthy();
    expect(screen.getByText('Enabled executors')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ctrl' })).toBeTruthy();
  });
});
