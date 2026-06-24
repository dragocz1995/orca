import { describe, it, expect } from 'vitest';
import { terminalWsUrl } from '../../lib/orcaClient';

// jsdom serves a default location (http://localhost) — assert relative to it so the test is host-agnostic.
describe('terminalWsUrl', () => {
  it('rides the same origin when there is no directPort (proxy / localhost)', () => {
    expect(terminalWsUrl('T1')).toBe(`ws://${location.host}/ws/terminal?ticket=T1`);
  });
  it('targets the daemon port straight in proxy-less IP mode', () => {
    expect(terminalWsUrl('T1', 4400)).toBe(`ws://${location.hostname}:4400/ws/terminal?ticket=T1`);
  });
  it('treats a null directPort as same-origin (config fetch failed / behind a proxy)', () => {
    expect(terminalWsUrl('T1', null)).toBe(`ws://${location.host}/ws/terminal?ticket=T1`);
  });
  it('url-encodes the ticket', () => {
    expect(terminalWsUrl('a/b=c')).toContain('ticket=a%2Fb%3Dc');
  });
});
