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
  save: (v: StatuslineConfig, onError: () => void) => void,
  onClose: () => void,
): StatuslineEditor => new StatuslineEditor({ tui: fakeTui(), current, onClose, save });

describe('StatuslineEditor', () => {
  it('renders a checkbox per CLI-editable field (context/tokens/cost, no Model)', () => {
    const rendered = make({ showContext: true, showTokens: false }, vi.fn(), vi.fn()).render(80).join('\n');
    expect(rendered).toContain('Statusline');
    expect(rendered).toContain('Context usage');
    expect(rendered).toContain('Cost');
    expect(rendered).not.toContain('Model'); // showModel is web-dock-only — inert in the CLI bar
    expect(rendered).toContain('[x]'); // showContext is on
    expect(rendered).toContain('[ ]'); // the rest are off
  });

  it('space toggles the highlighted field and saves the flipped values', () => {
    const save = vi.fn();
    make({ showContext: false }, save, vi.fn()).handleInput(SPACE); // first row = showContext
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ showContext: true }), expect.any(Function));
  });

  it('enter toggles a lower row after moving down', () => {
    const save = vi.fn();
    const ed = make({}, save, vi.fn());
    ed.handleInput(DOWN); // → showTokens
    ed.handleInput(ENTER);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ showTokens: true }), expect.any(Function));
  });

  it('toggling the same row twice returns to the original value', () => {
    const save = vi.fn();
    const ed = make({ showContext: false }, save, vi.fn());
    ed.handleInput(SPACE);
    ed.handleInput(SPACE);
    expect(save.mock.calls[0]![0]).toMatchObject({ showContext: true });
    expect(save.mock.calls[1]![0]).toMatchObject({ showContext: false });
  });

  it('rolls back the optimistic toggle when the save reports an error', () => {
    // save invokes its onError callback (a failed PATCH) — the checkbox must revert to unchecked.
    const save = vi.fn((_values: StatuslineConfig, onError: () => void) => onError());
    const ed = make({ showContext: false }, save, vi.fn());
    ed.handleInput(SPACE);
    expect(ed.render(80).join('\n')).not.toContain('[x]'); // rolled back — nothing is checked
  });

  it('esc closes without saving', () => {
    const save = vi.fn();
    const onClose = vi.fn();
    make(null, save, onClose).handleInput(ESC);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
