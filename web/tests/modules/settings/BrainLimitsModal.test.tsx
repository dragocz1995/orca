import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { BrainLimitsModal, BRAIN_LIMIT_DEFAULTS } from '../../../modules/settings/BrainLimitsModal';

describe('BrainLimitsModal', () => {
  it('opens field help as a floating layer above the limits modal', () => {
    render(
      <LanguageProvider>
        <BrainLimitsModal limits={BRAIN_LIMIT_DEFAULTS} onChange={() => {}} onClose={() => {}} />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Help' })[0]!);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass('absolute', 'z-50');
  });
});
