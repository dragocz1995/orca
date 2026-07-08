import { CURSOR_MARKER, ProcessTerminal, SelectList, TUI, decodeKittyPrintable, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { Component, Focusable, SelectItem } from '@earendil-works/pi-tui';
import { color, chatTheme } from '../chat/theme.js';
import { padAnsi } from './text.js';

const CANCEL: symbol = Symbol('elowen-prompt-cancel');

type MaybeCancel<T> = T | typeof CANCEL;
type Primitive = string | number | boolean;
type Option<T extends Primitive = string> = { value: T; label?: string; hint?: string; description?: string };
type SelectOptions<T extends Primitive> = {
  message: string;
  options: Option<T>[];
  initialValue?: T;
  note?: { title?: string; body: string };
};
type MultiSelectOptions<T extends Primitive> = SelectOptions<T> & {
  required?: boolean;
};
type TextOptions = {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  initialValue?: string;
  validate?: (value: string) => string | undefined | void;
};
type ConfirmOptions = {
  message: string;
  initialValue?: boolean;
};

export function isCancel(value: unknown): value is symbol {
  return value === CANCEL;
}

function interactive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function termWidth(): number {
  return Math.max(40, process.stdout.columns || 80);
}

function bg(text: string, width: number, bgCode = chatTheme().modalBg): string {
  return `\x1b[${bgCode}m${padAnsi(text, width)}\x1b[0m`;
}

function isMouseInput(data: string): boolean {
  return /^\x1b\[<\d+;\d+;\d+[mM]$/.test(data);
}

function sanitizePrintable(text: string): string {
  return [...text].filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code >= 32 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f);
  }).join('');
}

export function printableInput(data: string): string {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  let out = '';
  let rest = data;
  while (rest) {
    const start = rest.indexOf('\x1b[200~');
    if (start === -1) {
      if (!rest.includes('\x1b')) out += sanitizePrintable(rest);
      break;
    }
    out += sanitizePrintable(rest.slice(0, start));
    const pasted = rest.slice(start + 6);
    const end = pasted.indexOf('\x1b[201~');
    if (end === -1) {
      out += sanitizePrintable(pasted);
      break;
    }
    out += sanitizePrintable(pasted.slice(0, end));
    rest = pasted.slice(end + 6);
  }
  return out;
}

function frame(title: string, body: string[], width = Math.min(86, Math.max(48, termWidth() - 10))): string[] {
  const inner = Math.max(20, width - 4);
  const titleText = ` ${color.bold(color.text(title))} `;
  const rule = Math.max(0, inner - visibleWidth(titleText));
  const rows = [
    `${color.accent('╭')}${color.faint('─'.repeat(rule))}${titleText}${color.accent('╮')}`,
    ...body.flatMap((line) => wrapTextWithAnsi(line, inner).map((wrapped) => `${color.accent('│')}${bg(wrapped, inner)}${color.accent('│')}`)),
    `${color.accent('╰')}${color.faint('─'.repeat(inner))}${color.accent('╯')}`,
  ];
  const left = Math.max(0, Math.floor((termWidth() - width) / 2));
  return rows.map((line) => `${' '.repeat(left)}${line}`);
}

function writeBlock(title: string, body: string[] | string): void {
  const lines = Array.isArray(body) ? body : body.split('\n');
  process.stdout.write(`${frame(title, lines).join('\n')}\n`);
}

export function intro(message: string): void {
  writeBlock('Elowen', [message]);
}

export function outro(message: string): void {
  writeBlock('Done', [message]);
}

export function note(message: string, title = 'Note'): void {
  writeBlock(title, message);
}

export function cancel(message: string): void {
  writeBlock('Cancelled', [color.warning(message)]);
}

function logLine(kind: 'info' | 'success' | 'error' | 'warn' | 'step' | 'message', message: string): void {
  const dot = kind === 'success' ? color.success('●')
    : kind === 'error' ? color.error('●')
      : kind === 'warn' ? color.warning('●')
        : kind === 'step' ? color.accent('●')
          : color.faint('●');
  process.stdout.write(`  ${dot} ${message}\n`);
}

export const log = {
  info: (message: string): void => logLine('info', message),
  success: (message: string): void => logLine('success', message),
  error: (message: string): void => logLine('error', message),
  warn: (message: string): void => logLine('warn', message),
  step: (message: string): void => logLine('step', message),
  message: (message: string): void => logLine('message', message),
};

type SpinnerKind = 'success' | 'error' | 'warn' | 'info';

function logSpinner(kind: SpinnerKind, message: string): void {
  if (kind === 'error') log.error(message);
  else if (kind === 'warn') log.warn(message);
  else if (kind === 'info') log.info(message);
  else log.success(message);
}

export function spinner(): { start(message?: string): void; stop(message?: string, kind?: SpinnerKind): void } {
  let active = '';
  let frame = 0;
  let timer: NodeJS.Timeout | undefined;
  const frames = ['-', '\\', '|', '/'];
  const render = (): void => {
    if (!process.stdout.isTTY || !active) return;
    const glyph = color.accent(frames[frame++ % frames.length]!);
    process.stdout.write(`\r\x1b[2K  ${glyph} ${active}`);
  };
  const clear = (): void => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
  };
  return {
    start(message = 'Working'): void {
      active = message;
      if (!process.stdout.isTTY) {
        log.step(message);
        return;
      }
      render();
      timer = setInterval(render, 120);
    },
    stop(message?: string, kind: SpinnerKind = 'success'): void {
      clear();
      const final = message ?? (active || 'Done');
      active = '';
      if (final) logSpinner(kind, final);
    },
  };
}

function promptModal<T>(componentFactory: (finish: (value: MaybeCancel<T>) => void) => Component & Focusable): Promise<MaybeCancel<T>> {
  if (!interactive()) return Promise.resolve(CANCEL);
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TUI(terminal, true);
    let done = false;
    const finish = (value: MaybeCancel<T>): void => {
      if (done) return;
      done = true;
      tui.stop();
      process.stdout.write('\n');
      resolve(value);
    };
    const component = componentFactory(finish);
    tui.addChild(component);
    tui.setFocus(component);
    tui.start();
    tui.requestRender(true);
  });
}

class SelectPrompt<T extends Primitive> implements Component, Focusable {
  focused = true;
  private readonly list: SelectList;
  private filter = '';

  constructor(
    private readonly message: string,
    options: Option<T>[],
    initialValue: T | undefined,
    private readonly note: SelectOptions<T>['note'],
    private readonly finish: (value: MaybeCancel<T>) => void,
  ) {
    const items: SelectItem[] = options.map((option) => ({
      value: String(option.value),
      label: option.label ?? String(option.value),
      description: option.hint ?? option.description,
    }));
    this.list = new SelectList(items, 11, {
      selectedPrefix: (text) => color.selected(text),
      selectedText: (text) => color.selected(text),
      description: (text) => color.dim(text),
      scrollInfo: (text) => color.faint(text),
      noMatch: (text) => color.faint(text),
    }, { minPrimaryColumnWidth: 16 });
    const index = options.findIndex((option) => option.value === initialValue);
    if (index >= 0) this.list.setSelectedIndex(index);
    this.list.onSelect = (item) => {
      const option = options.find((candidate) => String(candidate.value) === item.value);
      this.finish((option?.value ?? item.value) as T);
    };
    this.list.onCancel = () => this.finish(CANCEL);
  }

  invalidate(): void { this.list.invalidate(); }

  render(width: number): string[] {
    const modal = Math.min(74, Math.max(42, width - 8));
    const inner = modal - 4;
    const lines = [
      color.bold(color.text(this.message)),
      color.faint(`Search ${this.filter ? color.text(this.filter) : color.faint('')}`),
      '',
      ...this.noteLines(inner),
      ...this.list.render(inner),
      '',
      color.faint('enter select · esc cancel'),
    ];
    return center(framePlain(lines, modal), width);
  }

  handleInput(data: string): void {
    if (isMouseInput(data)) return;
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.finish(CANCEL);
      return;
    }
    if (matchesKey(data, 'backspace')) {
      this.filter = this.filter.slice(0, -1);
      this.list.setFilter(this.filter);
      return;
    }
    const printable = printableInput(data);
    if (printable) {
      this.filter += printable;
      this.list.setFilter(this.filter);
      return;
    }
    this.list.handleInput(data);
  }

  private noteLines(width: number): string[] {
    if (!this.note?.body.trim()) return [];
    const title = this.note.title ? color.accent(this.note.title) : color.accent('Result');
    const body = this.note.body.trim().split('\n').slice(0, 18);
    const rows = [
      title,
      ...body.map((line) => `  ${color.dim(truncateToWidth(line, Math.max(1, width - 2), '…'))}`),
      '',
    ];
    return rows;
  }
}

class MultiSelectPrompt<T extends Primitive> implements Component, Focusable {
  focused = true;
  private index = 0;
  private readonly selected = new Set<string>();
  private error = '';

  constructor(
    private readonly message: string,
    private readonly options: Option<T>[],
    initialValue: T | undefined,
    private readonly required: boolean,
    private readonly finish: (value: MaybeCancel<T[]>) => void,
  ) {
    if (initialValue !== undefined) this.selected.add(String(initialValue));
  }

  invalidate(): void { /* state-driven */ }

  render(width: number): string[] {
    const modal = Math.min(84, Math.max(48, width - 8));
    const inner = modal - 4;
    const lines = [color.bold(color.text(this.message)), color.faint('space toggles · enter confirms'), ''];
    const start = Math.max(0, Math.min(this.index - 5, this.options.length - 11));
    for (const [offset, option] of this.options.slice(start, start + 11).entries()) {
      const i = start + offset;
      const checked = this.selected.has(String(option.value));
      const marker = checked ? color.success('☑') : color.faint('☐');
      const label = option.label ?? String(option.value);
      const desc = option.hint ?? option.description ?? '';
      const row = `${marker} ${truncateToWidth(label, 24, '…', true)} ${color.dim(truncateToWidth(desc, Math.max(1, inner - 30), '…'))}`;
      lines.push(i === this.index ? color.selected(row) : row);
    }
    if (this.options.length > 11) lines.push(color.faint(`${start + 1}-${Math.min(this.options.length, start + 11)} / ${this.options.length}`));
    if (this.error) lines.push('', color.warning(this.error));
    lines.push('', color.faint('enter select · esc cancel'));
    return center(framePlain(lines, modal), width);
  }

  handleInput(data: string): void {
    if (isMouseInput(data)) return;
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.finish(CANCEL);
    } else if (matchesKey(data, 'up')) {
      this.index = Math.max(0, this.index - 1);
    } else if (matchesKey(data, 'down')) {
      this.index = Math.min(this.options.length - 1, this.index + 1);
    } else if (matchesKey(data, 'space')) {
      const key = String(this.options[this.index]?.value ?? '');
      if (this.selected.has(key)) this.selected.delete(key);
      else this.selected.add(key);
      this.error = '';
    } else if (matchesKey(data, 'enter')) {
      if (this.required && this.selected.size === 0) {
        this.error = 'Select at least one option.';
        return;
      }
      const values = this.options.filter((option) => this.selected.has(String(option.value))).map((option) => option.value);
      this.finish(values);
    }
  }
}

class TextPrompt implements Component, Focusable {
  focused = true;
  private value: string;
  private error = '';

  constructor(
    private readonly message: string,
    private readonly opts: TextOptions,
    private readonly masked: boolean,
    private readonly finish: (value: MaybeCancel<string>) => void,
  ) {
    this.value = opts.initialValue ?? opts.defaultValue ?? '';
  }

  invalidate(): void { /* state-driven */ }

  render(width: number): string[] {
    const modal = Math.min(78, Math.max(48, width - 8));
    const inner = modal - 4;
    const shown = this.value ? (this.masked ? '•'.repeat(this.value.length) : this.value) : color.faint(this.opts.placeholder ?? '');
    const input = `${truncateToWidth(shown, inner - 2, '…')}${this.focused ? CURSOR_MARKER : ''}`;
    const lines = [
      color.bold(color.text(this.message)),
      '',
      bg(` ${input}`, inner, chatTheme().inputBg),
    ];
    if (this.error) lines.push('', color.warning(this.error));
    lines.push('', color.faint('enter submit · esc cancel'));
    return center(framePlain(lines, modal), width);
  }

  handleInput(data: string): void {
    if (isMouseInput(data)) return;
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.finish(CANCEL);
      return;
    }
    if (matchesKey(data, 'backspace')) {
      this.value = this.value.slice(0, -1);
      this.error = '';
      return;
    }
    if (matchesKey(data, 'enter')) {
      const err = this.opts.validate?.(this.value);
      if (err) {
        this.error = err;
        return;
      }
      this.finish(this.value);
      return;
    }
    const printable = printableInput(data);
    if (printable) {
      this.value += printable;
      this.error = '';
    }
  }
}

function framePlain(body: string[], width: number): string[] {
  const inner = width - 4;
  return [
    `${color.accent('╭')}${color.faint('─'.repeat(inner))}${color.accent('╮')}`,
    ...body.map((line) => `${color.accent('│')}${bg(truncateToWidth(line, inner, '…'), inner)}${color.accent('│')}`),
    `${color.accent('╰')}${color.faint('─'.repeat(inner))}${color.accent('╯')}`,
  ];
}

function center(lines: string[], width: number): string[] {
  const left = Math.max(0, Math.floor((width - Math.max(...lines.map(visibleWidth))) / 2));
  return ['', ...lines.map((line) => `${' '.repeat(left)}${line}`)];
}

export async function select<T extends Primitive = string>(opts: SelectOptions<T>): Promise<MaybeCancel<T>> {
  return promptModal((finish) => new SelectPrompt(opts.message, opts.options, opts.initialValue, opts.note, finish));
}

export async function multiselect<T extends Primitive = string>(opts: MultiSelectOptions<T>): Promise<MaybeCancel<T[]>> {
  return promptModal((finish) => new MultiSelectPrompt(opts.message, opts.options, opts.initialValue, opts.required ?? false, finish));
}

export async function text(opts: TextOptions): Promise<MaybeCancel<string>> {
  return promptModal((finish) => new TextPrompt(opts.message, opts, false, finish));
}

export async function password(opts: TextOptions): Promise<MaybeCancel<string>> {
  return promptModal((finish) => new TextPrompt(opts.message, opts, true, finish));
}

export async function confirm(opts: ConfirmOptions): Promise<MaybeCancel<boolean>> {
  return select<boolean>({
    message: opts.message,
    initialValue: opts.initialValue ?? true,
    options: [
      { value: true, label: 'Yes', hint: 'continue' },
      { value: false, label: 'No', hint: 'cancel' },
    ],
  });
}
