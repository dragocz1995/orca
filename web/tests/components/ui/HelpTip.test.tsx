import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { HelpTip } from '../../../components/ui/HelpTip';

describe('HelpTip', () => {
  it('portals a tooltip to the right of its trigger when there is no room on the left', () => {
    render(<LanguageProvider><HelpTip>Helpful context</HelpTip></LanguageProvider>);
    const trigger = screen.getByRole('button', { name: 'Help' });
    Object.defineProperty(trigger, 'getBoundingClientRect', {
      value: () => ({ top: 24, bottom: 40, left: 12, right: 28, width: 16, height: 16, x: 12, y: 24, toJSON: () => ({}) }),
    });

    fireEvent.click(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.parentElement).toBe(document.body);
    expect(tooltip.style.left).toBe('36px');
    expect(tooltip).toHaveClass('fixed', 'pointer-events-none');
  });
});
