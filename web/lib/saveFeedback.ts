import type { SaveStatus } from './useAutoSaveStatus';

/** One section's autosave state plus an optional retry for the error case. */
export type SaveFeedback = { status: SaveStatus; retry?: () => void };

/** Fold several sections' save states into one for a shared status indicator: error wins, then saving,
 *  then saved, else idle. */
export function combineSaveFeedback(...items: SaveFeedback[]): SaveFeedback {
  const error = items.find((item) => item.status === 'error');
  if (error) return error;
  if (items.some((item) => item.status === 'saving')) return { status: 'saving' };
  if (items.some((item) => item.status === 'saved')) return { status: 'saved' };
  return { status: 'idle' };
}
