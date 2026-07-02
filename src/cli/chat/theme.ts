/** Orca's terminal accent in one place. Raw ANSI (no chalk dep) — a 256-colour teal to match the Orca
 *  brand, plus muted/bold helpers. The rich markdown/editor rendering comes from pi's own theme
 *  (getMarkdownTheme/getSelectListTheme); this file only carries the Orca-specific accents and glyphs. */

const wrap = (code: string) => (s: string): string => `\x1b[${code}m${s}\x1b[0m`;

export const color = {
  accent: wrap('38;5;44'),    // Orca teal — primary brand
  accentDim: wrap('38;5;30'), // muted teal — secondary
  bold: wrap('1'),
  dim: wrap('90'),            // secondary text
  faint: wrap('38;5;240'),    // tertiary text (dividers, hints) — quieter than dim
  error: wrap('38;5;203'),    // soft red
  success: wrap('38;5;114'),  // soft green
};

/** Brand glyphs and labels. */
export const glyph = {
  whale: '🐋',
  tool: '⏺',      // filled dot — a tool call (Claude-Code style)
  you: 'ty',
  orca: 'orca',
  dot: '·',
};
