import { describe, it, expect } from 'vitest';
import { statusTone } from '../../../modules/dashboard/statusTone';

describe('statusTone', () => {
  it('maps each status to its tone', () => {
    expect(statusTone('open')).toBe('accent');
    expect(statusTone('in_progress')).toBe('accent');
    expect(statusTone('blocked')).toBe('danger');
    expect(statusTone('closed')).toBe('muted');
    expect(statusTone('cancelled')).toBe('muted');
  });
});
