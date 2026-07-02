/** Orca's terminal accent in one place. Raw ANSI (no chalk dep) — an opencode-style blue for rails and
 *  highlights, plus muted/faint helpers. The rich markdown/editor rendering comes from pi's own theme
 *  (getMarkdownTheme/getSelectListTheme); this file only carries the accent and glyphs. */

const wrap = (code: string) => (s: string): string => `\x1b[${code}m${s}\x1b[0m`;

export const color = {
  accent: wrap('38;5;75'),    // opencode blue — primary
  accentDim: wrap('38;5;68'), // muted blue — secondary
  bold: wrap('1'),
  dim: wrap('90'),            // secondary text
  faint: wrap('38;5;240'),    // tertiary text (dividers, hints)
  error: wrap('38;5;203'),    // soft red
  success: wrap('38;5;114'),  // soft green
};

/** Brand glyphs and labels. */
export const glyph = {
  whale: '🐋',
  tool: '⏺',      // filled dot — a tool call
  you: 'you',
  orca: 'orca',
  dot: '·',
};
