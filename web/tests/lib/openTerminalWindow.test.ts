import { describe, it, expect, vi, afterEach } from 'vitest';
import { openTerminalWindow } from '../../lib/openTerminalWindow';

afterEach(() => vi.restoreAllMocks());

describe('openTerminalWindow', () => {
  it('opens the chromeless terminal route in a session-keyed window', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openTerminalWindow('elowen-advisor-1');
    expect(open).toHaveBeenCalledWith('/terminal/elowen-advisor-1', 'elowen-terminal-elowen-advisor-1', expect.stringContaining('width=900'));
  });

  it('url-encodes the session name', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openTerminalWindow('elowen/weird name');
    expect(open.mock.calls[0]![0]).toBe('/terminal/elowen%2Fweird%20name');
  });
});
