export type DerivedSignal =
  | { type: 'working' }
  | { type: 'complete' }
  | { type: 'needs_input'; question: string; options: { id: string; label: string }[]; context: string };
export interface SignalSink { emit(session: string, s: DerivedSignal): void }
