'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orcaClient } from './orcaClient';
import { QUERY_KEYS } from './queries';
import type { CreateTaskInput, UpdateTaskInput, PlanInput, EngageInput, ConfigPatch, InsertPhasesInput, HermesInstallInput, UserPatch } from './types';

export function useSpawn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string; exec?: string }) => orcaClient.spawn(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }); qc.invalidateQueries({ queryKey: QUERY_KEYS.sessions }); },
  });
}
export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateTaskInput) => orcaClient.createTask(input), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }) });
}
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; patch: UpdateTaskInput }) => orcaClient.updateTask(v.id, v.patch), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }) });
}
export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => orcaClient.deleteTask(id), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }) });
}
export function usePlanTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlanInput) => orcaClient.planTask(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }); qc.invalidateQueries({ queryKey: QUERY_KEYS.missions }); },
  });
}
export function useInsertPhases() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { epicId: string; body: InsertPhasesInput }) => orcaClient.insertPhases(v.epicId, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks });
      qc.invalidateQueries({ queryKey: ['mission'] });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.missions });
    },
  });
}
export function useCloseTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => orcaClient.closeTask(id), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }) });
}
export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; status: string }) => orcaClient.setTaskStatus(v.id, v.status), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }) });
}
export function useSetTaskExec() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; exec: string }) => orcaClient.setTaskExec(v.id, v.exec), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.tasks }) });
}
export function useKillSession() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => orcaClient.killSession(name), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.sessions }) });
}
export function useSendInput() {
  return useMutation({ mutationFn: (v: { name: string; keys: string[] }) => orcaClient.sendKeys(v.name, v.keys) });
}
export function useEngage() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: EngageInput) => orcaClient.engage(input), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.missions }) });
}
export function usePauseMission() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => orcaClient.pauseMission(id), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.missions }) });
}
export function useResumeMission() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => orcaClient.resumeMission(id), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.missions }) });
}
export function useDisengage() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => orcaClient.disengageMission(id), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.missions }) });
}
export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (patch: ConfigPatch) => orcaClient.updateConfig(patch), onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.config }) });
}
export function useLogin() {
  return useMutation({ mutationFn: (v: { username: string; password: string }) => orcaClient.login(v.username, v.password) });
}
export function useLogout() {
  return useMutation({ mutationFn: () => orcaClient.logout() });
}
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { username: string; password: string }) => orcaClient.createUser(v.username, v.password), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) });
}
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: number) => orcaClient.deleteUser(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; patch: UserPatch }) => orcaClient.updateUser(v.id, v.patch),
    // Refresh the list and the current identity (an admin could change their own role).
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['me'] }); },
  });
}
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { slug: string; path: string; notes?: string }) => orcaClient.createProject(v), onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }) });
}
export function useAssignProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: number; projectId: number; assigned: boolean }) =>
      v.assigned ? orcaClient.unassignProject(v.userId, v.projectId) : orcaClient.assignProject(v.userId, v.projectId),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['user-projects', v.userId] }),
  });
}
export function useWriteProjectFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; path: string; content: string }) => orcaClient.writeProjectFile(v.id, v.path, v.content),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['project-file', v.id, v.path] });
      qc.invalidateQueries({ queryKey: ['project-diff', v.id, v.path] });
      qc.invalidateQueries({ queryKey: ['project-git', v.id] });
    },
  });
}
/** Invalidate everything that a file-tree mutation (create/rename/copy/delete) can affect. */
function invalidateProjectTree(qc: ReturnType<typeof useQueryClient>, id: number) {
  qc.invalidateQueries({ queryKey: ['project-files', id] });
  qc.invalidateQueries({ queryKey: ['project-git', id] });
  qc.invalidateQueries({ queryKey: ['project-changed', id] });
}
export function useNewProjectFile() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; path: string }) => orcaClient.newProjectFile(v.id, v.path), onSuccess: (_r, v) => invalidateProjectTree(qc, v.id) });
}
export function useNewProjectDir() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; path: string }) => orcaClient.newProjectDir(v.id, v.path), onSuccess: (_r, v) => invalidateProjectTree(qc, v.id) });
}
export function useRenameProjectEntry() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; from: string; to: string }) => orcaClient.renameProjectEntry(v.id, v.from, v.to), onSuccess: (_r, v) => invalidateProjectTree(qc, v.id) });
}
export function useCopyProjectEntry() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; from: string; to: string }) => orcaClient.copyProjectEntry(v.id, v.from, v.to), onSuccess: (_r, v) => invalidateProjectTree(qc, v.id) });
}
export function useDeleteProjectEntry() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; path: string }) => orcaClient.deleteProjectEntry(v.id, v.path), onSuccess: (_r, v) => invalidateProjectTree(qc, v.id) });
}
export function useHermesInstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HermesInstallInput) => orcaClient.hermesInstall(input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: variables.home ? ['hermes-status', variables.home] : ['hermes-status'] });
    },
  });
}
