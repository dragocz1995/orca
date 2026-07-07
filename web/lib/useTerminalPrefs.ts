import { useMyTerminalSettings } from './queries';
import { TERMINAL_DEFAULTS } from '../components/terminal/palettes';
import type { TerminalSettings } from './types';

/** The current user's terminal appearance settings, always fully populated: while the query is loading
 *  (or for an unauthenticated context) it returns the defaults (`theme:'auto'`), so xterm instances
 *  never flash and pre-feature behaviour is preserved. Every web xterm consumes this. */
export function useTerminalPrefs(): TerminalSettings {
  const { data } = useMyTerminalSettings();
  return data ?? TERMINAL_DEFAULTS;
}
