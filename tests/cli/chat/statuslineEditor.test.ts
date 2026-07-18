import { describe, it, expect, vi } from 'vitest';
import { StatuslineEditor } from '../../../src/cli/chat/statuslineEditor.js';
import type { TUI } from '@earendil-works/pi-tui';
import type { StatuslineConfig } from '../../../src/cli/chat/brainClient.js';

const ENTER = '\r';
const ESC = '\x1b';
const DOWN = '\x1b[B';
const SPACE = ' ';

const fakeTui = (): TUI => ({ requestRender: vi.fn() } as unknown as TUI);

const make = (
  current: StatuslineConfig | null,
  save: (v: StatuslineConfig) => void,
  onClose: () => void,
): StatuslineEditor => new StatuslineEditor({ tui: fakeTui(), current, onClose, save });

describe('StatuslineEditor', () => {
  it('renders a checkbox per field reflecting the current config', () => {
    const rendered = make({ showModel: true, showContext: false }, vi.fn(), vi.fn()).render(80).join('\n');
    expect(rendered).toContain('Statusline');
    expect(rendered).toContain('Model');
    expect(rendered).toContain('Cost');
    expect(rendered).toContain('[x]'); // showModel is on
    expect(rendered).toContain('[ ]'); // the rest are off
  });

  it('space toggles the highlighted field and saves the flipped values', () => {
    const save = vi.fn();
    make({ showModel: false }, save, vi.fn()).handleInput(SPACE); // first row = showModel
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ showModel: true }));
  });

  it('enter toggles a lower row after moving down', () => {
    const save = vi.fn();
    const ed = make({}, save, vi.fn());
    ed.handleInput(DOWN); // → showContext
    ed.handleInput(ENTER);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ showContext: true }));
  });

  it('toggling the same row twice returns to the original value', () => {
    const save = vi.fn();
    const ed = make({ showModel: false }, save, vi.fn());
    ed.handleInput(SPACE);
    ed.handleInput(SPACE);
    expect(save).toHaveBeenNthCalledWith(1, expect.objectContaining({ showModel: true }));
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ showModel: false }));
  });

  it('esc closes without saving', () => {
    const save = vi.fn();
    const onClose = vi.fn();
    make(null, save, onClose).handleInput(ESC);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
