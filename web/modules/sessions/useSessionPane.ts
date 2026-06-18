'use client';
import { useQuery } from '@tanstack/react-query';
import { orcaClient } from '../../lib/orcaClient';

/** Poll a session's tmux pane (ANSI-aware) for a lightweight live preview (last `lines` rows). */
export function useSessionPane(name: string, lines = 8) {
  const q = useQuery({
    queryKey: ['session-pane', name, 'ansi'],
    queryFn: () => orcaClient.sessionPane(name, true),
    refetchInterval: 2000,
    refetchOnWindowFocus: false,
  });
  const pane = q.data?.pane ?? '';
  const tail = pane.split('\n').slice(-lines).join('\n');
  return { tail, isLoading: q.isLoading, isError: q.isError };
}
