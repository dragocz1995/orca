import type { TerminalPalette, TerminalSettings, TerminalFontFamily } from '../../lib/types';

/** Font-family id → CSS font stack. Kept in sync with the server copy in `src/store/terminalSettings.ts`.
 *  v1 ships only system-installed monospace fonts (no web-font downloads). */
export const FONT_STACKS: Record<TerminalFontFamily, string> = {
  system: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  menlo: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
  ibm: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace',
  courier: '"Courier New", Courier, monospace',
};

export const DARK_PALETTE: TerminalPalette = {
  background: '#000000', foreground: '#f5f5f5', cursor: '#f5f5f5', cursorAccent: '#000000', selectionBackground: '#2c4870',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff',
};

const LIGHT_PALETTE: TerminalPalette = {
  background: '#ffffff', foreground: '#232323', cursor: '#232323', cursorAccent: '#ffffff', selectionBackground: '#cfe0ff',
  black: '#232323', red: '#c4314b', green: '#166534', yellow: '#946200', blue: '#1d4ed8', magenta: '#9333ea', cyan: '#0e7490', white: '#6b6b6b',
  brightBlack: '#6b6b6b', brightRed: '#dc2626', brightGreen: '#16a34a', brightYellow: '#ca8a04', brightBlue: '#2563eb', brightMagenta: '#a855f7', brightCyan: '#0891b2', brightWhite: '#111827',
};

const SOLARIZED_DARK: TerminalPalette = {
  background: '#002b36', foreground: '#839496', cursor: '#839496', cursorAccent: '#002b36', selectionBackground: '#073642',
  black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
  brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
};

const DRACULA: TerminalPalette = {
  background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', cursorAccent: '#282a36', selectionBackground: '#44475a',
  black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
  brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
};

const GRUVBOX_DARK: TerminalPalette = {
  background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', cursorAccent: '#282828', selectionBackground: '#504945',
  black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
  brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
};

/** Preset palettes offered in the section's "load preset" dropdown; selecting one fills all 21 swatches,
 *  which the user can then tweak. Labels are proper nouns (not translated). */
export const PALETTE_PRESETS: { id: string; label: string; palette: TerminalPalette }[] = [
  { id: 'elowen-dark', label: 'Elowen Dark', palette: DARK_PALETTE },
  { id: 'elowen-light', label: 'Elowen Light', palette: LIGHT_PALETTE },
  { id: 'solarized-dark', label: 'Solarized Dark', palette: SOLARIZED_DARK },
  { id: 'dracula', label: 'Dracula', palette: DRACULA },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', palette: GRUVBOX_DARK },
];

/** Ordered palette fields for the swatch grid + ITheme building (mirrors TerminalPalette keys). */
export const PALETTE_KEYS: (keyof TerminalPalette)[] = [
  'background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

/** Canonical client-side defaults — mirror of the server's TERMINAL_DEFAULTS. Used as the loading/unauth
 *  fallback and as the base the Account section seeds from. */
export const TERMINAL_DEFAULTS: TerminalSettings = {
  fontSize: 12,
  fontFamily: 'system',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 1000,
  theme: 'auto',
  palette: DARK_PALETTE,
  showThoughtsCli: true,
};
