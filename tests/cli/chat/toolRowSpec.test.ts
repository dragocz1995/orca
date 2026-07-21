import { describe, it, expect } from 'vitest';
import { toolRowSpec } from '../../../src/cli/chat/turnRenderer.js';

describe('toolRowSpec', () => {
  it('titles a tool with its literal name, not a verb guessed from the name', () => {
    // The regression: `*Create*`/`*Write*` tools used to be relabelled as a file "Write".
    expect(toolRowSpec('CreateSkill', 'elowen').title).toBe('CreateSkill elowen');
    expect(toolRowSpec('TodoWrite').title).toBe('TodoWrite');
    expect(toolRowSpec('ElowenCreateTask').title).toBe('ElowenCreateTask');
    expect(toolRowSpec('Write', 'a.ts').title).toBe('Write a.ts');
    expect(toolRowSpec('Edit', 'a.ts').title).toBe('Edit a.ts');
    expect(toolRowSpec('Read', 'a.ts').title).toBe('Read a.ts');
  });

  it('keeps the monochrome direction glyph from the name', () => {
    expect(toolRowSpec('Write').glyph).toBe('←');
    expect(toolRowSpec('Edit').glyph).toBe('←');
    expect(toolRowSpec('CreateSkill').glyph).toBe('←');
    expect(toolRowSpec('Read').glyph).toBe('→');
    expect(toolRowSpec('ListDir').glyph).toBe('→');
    expect(toolRowSpec('Search').glyph).toBe('✱');
    expect(toolRowSpec('LspDiagnostics').glyph).toBe('✱');
    expect(toolRowSpec('WebFetch').glyph).toBe('%');
    expect(toolRowSpec('Bash').glyph).toBe('⚙');
  });

  it('quotes a search detail (the query) but not other details', () => {
    expect(toolRowSpec('Search', 'auth jwt').title).toBe('Search "auth jwt"');
    expect(toolRowSpec('Search').title).toBe('Search');
  });
});
