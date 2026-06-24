import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { DateRangeFilter } from '../../../modules/timeline/DateRangeFilter';
import { DEFAULT_RANGE } from '../../../modules/timeline/dateRange';

const renderFilter = (onChange = vi.fn()) => {
  render(
    <LanguageProvider>
      <DateRangeFilter value={DEFAULT_RANGE} onChange={onChange} />
    </LanguageProvider>,
  );
  return onChange;
};

describe('timeline/DateRangeFilter', () => {
  it('is collapsed until the trigger is clicked', () => {
    renderFilter();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows all three presets when open', () => {
    renderFilter();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const presets = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    expect(presets).toHaveLength(3);
  });

  it('picking a preset reports it and closes the popover', () => {
    const onChange = renderFilter();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // Presets render in order [7d, 30d, all]; the 3rd is "all".
    const presets = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    fireEvent.click(presets[2]);
    expect(onChange).toHaveBeenCalledWith({ preset: 'all' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the active preset has aria-pressed=true', () => {
    renderFilter();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const presets = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null);
    // DEFAULT_RANGE is 7d — first preset should be pressed
    expect(presets[0].getAttribute('aria-pressed')).toBe('true');
    expect(presets[1].getAttribute('aria-pressed')).toBe('false');
    expect(presets[2].getAttribute('aria-pressed')).toBe('false');
  });
});
