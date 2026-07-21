import { describe, it, expect } from 'vitest';
import { KNOWN_EXECS, PROGRAM_PREFIXES, BARE_WITH_SLASH_PROGRAM, BARE_PLAIN_PROGRAM } from '../../src/shared/execs.js';
import { EXEC_PRESETS } from '../../web/lib/execPresets';
import { execProvider } from '../../web/lib/modelProvider';

// The exec allow-list and the provider-prefix routing table are hand-mirrored in the web bundle (it can't
// import the daemon's NodeNext source). Root vitest CAN import both trees, so pin them in lockstep here:
// add a model to KNOWN_EXECS without adding its web preset (or vice-versa) and this fails instead of the
// model silently missing from the dashboard's picker.
describe('exec / provider parity (web ↔ daemon)', () => {
  it('web exec presets cover exactly the daemon KNOWN_EXECS allow-list, in order', () => {
    expect(EXEC_PRESETS.map((p) => p.exec)).toEqual([...KNOWN_EXECS]);
  });

  it('web execProvider resolves every prefix to the same program as PROGRAM_PREFIXES', () => {
    for (const [prefix, program] of Object.entries(PROGRAM_PREFIXES)) {
      expect(execProvider(`${prefix}some-model`)).toBe(program);
    }
    expect(execProvider('provider/model')).toBe(BARE_WITH_SLASH_PROGRAM); // bare, slash → opencode
    expect(execProvider('sonnet')).toBe(BARE_PLAIN_PROGRAM);              // bare, plain → claude-code
  });
});
