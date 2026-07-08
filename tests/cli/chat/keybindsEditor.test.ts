import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeybindsEditor } from '../../../src/cli/chat/keybindsEditor.js';
import { activeKeymap, initKeymap, KEYBIND_ACTIONS } from '../../../src/cli/chat/keys.js';
import { loadPrefs } from '../../../src/cli/chat/prefs.js';
import type { KeybindAction } from '../../../src/cli/chat/keys.js';

// Raw terminal bytes for the keys the editor captures / navigates with.
const CTRL = (letter: string): string => String.fromCharCode(letter.charCodeAt(0) - 96);
const ENTER = '\r';
const ESC = '\x1b';
const DOWN = '\x1b[B';
const DELETE = '\x1b[3~';

const fakeTui = (): { requestRender: ReturnType<typeof vi.fn> } => ({ requestRender: vi.fn() });

/** Drive the editor to the row for `action`, then run `keys` through handleInput. */
function driveTo(editor: KeybindsEditor, action: KeybindAction, keys: string[]): void {
  const steps = KEYBIND_ACTIONS.indexOf(action);
  for (let i = 0; i < steps; i++) editor.handleInput(DOWN);
  for (const k of keys) editor.handleInput(k);
}

describe('KeybindsEditor — interactive flow', () => {
  let home: string;
  let prevHome: string | undefined;
  let reload: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Isolate cli-prefs.json under a throwaway HOME (dataDir → $HOME/.config/orca).
    home = mkdtempSync(join(tmpdir(), 'orca-kb-'));
    prevHome = process.env.HOME;
    process.env.HOME = home;
    initKeymap({}); // start every case from the stock keymap
    reload = vi.fn();
    onClose = vi.fn();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    initKeymap({});
  });

  const makeEditor = (): KeybindsEditor => new KeybindsEditor({ tui: fakeTui(), onClose, reload });

  it('Enter → capture → a valid chord sets the override, persists it and live-applies via initKeymap', () => {
    const editor = makeEditor();
    driveTo(editor, 'reasoning_cycle', [ENTER, CTRL('t')]);
    expect(loadPrefs().keybinds).toEqual({ reasoning_cycle: 'ctrl+t' });
    expect(activeKeymap().matches('reasoning_cycle', CTRL('t'))).toBe(true);
    expect(activeKeymap().matches('reasoning_cycle', CTRL('r'))).toBe(false);
    expect(reload).toHaveBeenCalled();
  });

  it('a bare letter is rejected with the leader hint and leaves the binding untouched', () => {
    const editor = makeEditor();
    driveTo(editor, 'reasoning_cycle', [ENTER, 't']);
    expect(loadPrefs().keybinds ?? {}).toEqual({});
    expect(activeKeymap().matches('reasoning_cycle', CTRL('r'))).toBe(true); // default kept
    const rendered = editor.render(80).join('\n');
    expect(rendered).toContain('use a ctrl/alt chord');
    expect(reload).not.toHaveBeenCalled();
  });

  it('pressing the leader in capture mode composes a "leader <key>" sequence', () => {
    const editor = makeEditor();
    // theme_picker → capture → leader (ctrl+x) → 'g'  ⇒ "leader g"
    driveTo(editor, 'theme_picker', [ENTER, CTRL('x'), 'g']);
    expect(loadPrefs().keybinds).toEqual({ theme_picker: 'leader g' });
    expect(activeKeymap().leaderAction('g')).toBe('theme_picker');
  });

  it('x unbinds the row to "none"', () => {
    const editor = makeEditor();
    driveTo(editor, 'stash', ['x']);
    expect(loadPrefs().keybinds).toEqual({ stash: 'none' });
    expect(activeKeymap().matches('stash', CTRL('s'))).toBe(false);
    expect(activeKeymap().chordLabel('stash')).toBeNull();
  });

  it('r resets a customized row back to default (drops the override)', () => {
    driveTo(makeEditor(), 'stash', [ENTER, CTRL('g')]);
    expect(loadPrefs().keybinds).toEqual({ stash: 'ctrl+g' });
    // A fresh editor (selection back at the top) picks up the persisted override, then resets it.
    driveTo(makeEditor(), 'stash', ['r']);
    expect(loadPrefs().keybinds ?? {}).toEqual({});
    expect(activeKeymap().matches('stash', CTRL('s'))).toBe(true);
  });

  it('rebinding a row to its own default is pruned rather than stored as custom', () => {
    const editor = makeEditor();
    driveTo(editor, 'reasoning_cycle', [ENTER, CTRL('r')]); // ctrl+r IS the default
    expect(loadPrefs().keybinds ?? {}).toEqual({});
  });

  it('esc in capture returns to the list without changing anything; esc in list closes', () => {
    const editor = makeEditor();
    driveTo(editor, 'reasoning_cycle', [ENTER, ESC]);
    expect(loadPrefs().keybinds ?? {}).toEqual({});
    expect(onClose).not.toHaveBeenCalled();
    editor.handleInput(ESC);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces a collision warning live when binding onto an occupied chord', () => {
    const editor = makeEditor();
    // subagent_cycle (earlier in order) grabs ctrl+p, telemetry_toggle's default → telemetry unreachable.
    driveTo(editor, 'subagent_cycle', [ENTER, CTRL('p')]);
    expect(activeKeymap().warnings.some((w) =>
      w.includes('telemetry_toggle') && w.includes('subagent_cycle') && w.includes('unreachable'))).toBe(true);
    const rendered = editor.render(90).join('\n');
    expect(rendered).toContain('unreachable');
  });

  it('Delete also unbinds the row', () => {
    const editor = makeEditor();
    driveTo(editor, 'stash', [DELETE]);
    expect(loadPrefs().keybinds).toEqual({ stash: 'none' });
  });
});
