import { SelectList, Container, Editor, matchesKey } from '@earendil-works/pi-tui';
import type { SelectItem, TUI } from '@earendil-works/pi-tui';
import { getSelectListTheme } from '@earendil-works/pi-coding-agent';
import { color } from './theme.js';
import { padAnsi } from '../ui/text.js';

/** The Editor with an Esc hook: Esc aborts the streaming turn (unless the autocomplete popup is open —
 *  then Esc closes it, handled by the base class). */
export class ChatEditor extends Editor {
  onEscape?: () => void;
  override handleInput(data: string): void {
    if (matchesKey(data, 'escape') && !this.isShowingAutocomplete() && this.onEscape) {
      this.onEscape();
      return;
    }
    super.handleInput(data);
  }
}

/** Shape the stored conversations for the /resume picker (most recent first, as listed). */
export function sessionItems(sessions: { id: string; title: string; model: string; updated_at: string; active: boolean }[]): SelectItem[] {
  return sessions.map((s) => ({
    value: s.id,
    label: `${s.active ? '▸ ' : ''}${s.title || '(untitled)'}`,
    description: `${s.model}${s.updated_at ? ` · ${s.updated_at.slice(0, 16)}` : ''}`,
  }));
}

/** Shape the configured models for the /model picker: the current model floats to the top. */
export function modelItems(models: { provider: string; providerLabel: string; model: string }[], currentModel: string): SelectItem[] {
  const items = models.map((m) => ({
    value: `${m.provider} ${m.model}`,
    label: `${m.model === currentModel ? '▸ ' : ''}${m.model}`,
    description: m.providerLabel,
  }));
  return [...items.filter((i) => i.label.startsWith('▸ ')), ...items.filter((i) => !i.label.startsWith('▸ '))];
}

/** Split a model picker value back into its provider/model selection. */
export function parseModelValue(value: string): { provider: string; model: string } {
  const [provider = '', model = ''] = value.split(' ');
  return { provider, model };
}

export interface PickerOpts {
  tui: TUI;
  /** Kept for compatibility with the previous inline picker; modals no longer mutate this slot. */
  slot: Container;
  editor: Editor;
  items: SelectItem[];
  title: string;
  onPick: (value: string) => void;
  footer?: string;
  onInput?: (data: string, selected: SelectItem | null, close: () => void) => boolean;
}

class PickerModal {
  private list: SelectList;

  constructor(
    private readonly title: string,
    items: SelectItem[],
    private readonly onPick: (value: string) => void,
    private readonly onCancel: () => void,
    private readonly footer = 'enter select · esc close',
    private readonly onInput?: (data: string, selected: SelectItem | null, close: () => void) => boolean,
  ) {
    this.list = new SelectList(items, 12, getSelectListTheme(), {
      minPrimaryColumnWidth: 30,
      maxPrimaryColumnWidth: 34,
    });
    this.list.onSelect = (item) => this.onPick(item.value);
    this.list.onCancel = this.onCancel;
  }

  invalidate(): void { this.list.invalidate(); }
  handleInput(data: string): void {
    if (this.onInput?.(data, this.list.getSelectedItem(), this.onCancel)) return;
    this.list.handleInput(data);
  }

  render(width: number): string[] {
    const bodyWidth = Math.max(1, width - 4);
    return [
      color.modalBg(padAnsi(`  ${color.bold(color.text(this.title))}${color.faint(' '.repeat(Math.max(1, bodyWidth - visibleTitle(this.title))) + 'esc')}`, width)),
      color.modalBg(padAnsi('', width)),
      ...this.list.render(bodyWidth).map((line) => color.modalBg(`  ${padAnsi(line, bodyWidth)}  `)),
      color.modalBg(padAnsi('', width)),
      color.modalBg(padAnsi(`  ${color.text(this.footer)}`, width)),
    ];
  }
}

function visibleTitle(title: string): number {
  return Math.min(24, title.length + 6);
}

/** Show an arrow-key picker as a centered modal. Enter picks, Esc restores editor focus untouched. */
export function openPicker(o: PickerOpts): void {
  const restore = (): void => {
    o.tui.setFocus(o.editor);
    o.tui.requestRender();
  };
  if (o.items.length === 0) { restore(); return; }
  let handle: ReturnType<TUI['showOverlay']> | null = null;
  const close = (): void => {
    handle?.hide();
    handle = null;
    restore();
  };
  const modal = new PickerModal(o.title, o.items, (value) => {
    close();
    o.onPick(value);
  }, close, o.footer, o.onInput);
  handle = o.tui.showOverlay(modal, {
    anchor: 'center',
    width: 60,
    maxHeight: 22,
    margin: 2,
  });
  handle.focus();
  o.tui.requestRender();
}

class TextInputModal {
  private value: string;
  constructor(
    private readonly title: string,
    initial: string,
    private readonly onSubmit: (value: string) => void,
    private readonly onCancel: () => void,
  ) { this.value = initial; }
  invalidate(): void { /* state driven */ }
  handleInput(data: string): void {
    if (matchesKey(data, 'escape')) { this.onCancel(); return; }
    if (matchesKey(data, 'enter')) { this.onSubmit(this.value); return; }
    if (matchesKey(data, 'backspace') || data === '\x7f') { this.value = this.value.slice(0, -1); return; }
    if (data >= ' ' && data !== '\x7f' && !data.startsWith('\x1b')) this.value += data;
  }
  render(width: number): string[] {
    const bodyWidth = Math.max(1, width - 4);
    const shown = this.value || color.faint('(empty)');
    return [
      color.modalBg(padAnsi(`  ${color.bold(color.text(this.title))}${color.faint(' '.repeat(Math.max(1, bodyWidth - visibleTitle(this.title))) + 'esc')}`, width)),
      color.modalBg(padAnsi('', width)),
      color.modalBg(`  ${padAnsi(color.text(shown), bodyWidth)}  `),
      color.modalBg(padAnsi('', width)),
      color.modalBg(padAnsi(`  ${color.text('enter save')} ${color.faint('·')} ${color.text('esc cancel')}`, width)),
    ];
  }
}

export function openTextInput(o: { tui: TUI; editor: Editor; title: string; initial?: string; onSubmit: (value: string) => void }): void {
  const restore = (): void => { o.tui.setFocus(o.editor); o.tui.requestRender(); };
  let handle: ReturnType<TUI['showOverlay']> | null = null;
  const close = (): void => { handle?.hide(); handle = null; restore(); };
  const modal = new TextInputModal(o.title, o.initial ?? '', (value) => { close(); o.onSubmit(value); }, close);
  handle = o.tui.showOverlay(modal, { anchor: 'center', width: 64, maxHeight: 8, margin: 2 });
  handle.focus();
  o.tui.requestRender();
}
