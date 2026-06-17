import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ModuleShell } from '../../../components/shell/ModuleShell';

describe('ModuleShell', () => {
  it('wraps children in a data-module section', () => {
    const { container } = render(<ModuleShell moduleId="settings"><span>x</span></ModuleShell>);
    const root = container.querySelector('[data-module="settings"]');
    expect(root).not.toBeNull();
    expect(root?.textContent).toBe('x');
  });
});
