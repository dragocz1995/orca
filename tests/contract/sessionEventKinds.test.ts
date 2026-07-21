import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_EVENT_KINDS } from '../../src/store/brainStore.js';

// The session-event kind set lives in the TS type AND in the schema.sql CHECK constraint (SQLite can't
// import the TS list). A kind present in SESSION_EVENT_KINDS but missing from the CHECK makes
// appendSessionEvent throw at runtime — this test keeps the two in lockstep.
describe('session-event kind ↔ schema CHECK parity', () => {
  it('every SESSION_EVENT_KINDS value is permitted by the brain_session_events CHECK', () => {
    const schema = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/store/schema.sql'), 'utf8');
    const m = /brain_session_events[\s\S]*?kind TEXT NOT NULL CHECK \(kind IN \(([^)]+)\)\)/.exec(schema);
    expect(m, 'brain_session_events kind CHECK constraint not found in schema.sql').not.toBeNull();
    const checkKinds = m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    for (const kind of SESSION_EVENT_KINDS) expect(checkKinds).toContain(kind);
  });
});
