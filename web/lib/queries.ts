import { useQuery } from '@tanstack/react-query';
import { orcaClient } from './orcaClient';

export const QUERY_KEYS = {
  tasks: ['tasks'] as const,
  sessions: ['sessions'] as const,
  missions: ['missions'] as const,
  health: ['health'] as const,
  config: ['config'] as const,
};

export const useTasks = () =>
  useQuery({ queryKey: QUERY_KEYS.tasks, queryFn: orcaClient.tasks });

export const useSessions = () =>
  useQuery({ queryKey: QUERY_KEYS.sessions, queryFn: orcaClient.sessions });

export const useMissions = () =>
  useQuery({ queryKey: QUERY_KEYS.missions, queryFn: orcaClient.missions });

export const useHealth = () =>
  useQuery({
    queryKey: QUERY_KEYS.health,
    queryFn: orcaClient.health,
    refetchInterval: 10000,
  });

export const useConfig = () =>
  useQuery({ queryKey: QUERY_KEYS.config, queryFn: orcaClient.getConfig });

export const useMissionDetail = (id: string | null) =>
  useQuery({
    queryKey: ['mission', id],
    queryFn: () => orcaClient.getMissionDetail(id as string),
    enabled: !!id,
  });

export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: orcaClient.listUsers });
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: orcaClient.me });

export const useActivity = (type?: string) =>
  useQuery({ queryKey: ['activity', type ?? 'all'], queryFn: () => orcaClient.activity(type ? { type } : undefined) });
