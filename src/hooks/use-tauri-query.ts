import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  RepoInfo,
  CheckpointSummary,
  TranscriptMessage,
  FileDiff,
  EntireSettings,
  EntireLogResult,
  SessionState,
  CreateWorktreeOptions,
  DeleteWorktreeOptions,
} from "../lib/ipc";
export type { EntireLogResult } from "../lib/ipc";

export function useReposQuery() {
  return useQuery<RepoInfo[]>({
    queryKey: ["repos"],
    queryFn: () => invoke("list_repos"),
    retry: false,
  });
}

export function useCheckpointsQuery(repoPath: string, branch: string) {
  return useQuery<CheckpointSummary[]>({
    queryKey: ["checkpoints", repoPath, branch],
    queryFn: () => invoke("list_checkpoints", { repoPath, branch }),
    enabled: !!repoPath,
    retry: false,
  });
}

export function useTranscriptQuery(
  repoPath: string,
  checkpointId: string,
  sessionIndex: number
) {
  return useQuery<TranscriptMessage[]>({
    queryKey: ["transcript", repoPath, checkpointId, sessionIndex],
    queryFn: () =>
      invoke("get_transcript", { repoPath, checkpointId, sessionIndex }),
    enabled: !!repoPath && !!checkpointId,
    retry: false,
  });
}

export function useDiffQuery(repoPath: string, commitSha: string) {
  return useQuery<FileDiff[]>({
    queryKey: ["diff", repoPath, commitSha],
    queryFn: () => invoke("get_checkpoint_diff", { repoPath, commitSha }),
    enabled: !!repoPath && !!commitSha,
    retry: false,
  });
}

export function useBranchDiffQuery(repoPath: string, branch: string) {
  return useQuery<FileDiff[]>({
    queryKey: ["branch-diff", repoPath, branch],
    queryFn: () => invoke("get_branch_diff", { repoPath, branch }),
    enabled: !!repoPath && !!branch,
    retry: false,
  });
}

export function useEntireSettingsQuery(repoPath: string) {
  return useQuery<EntireSettings>({
    queryKey: ["entire-settings", repoPath],
    queryFn: () => invoke("get_entire_settings", { repoPath }),
    enabled: !!repoPath,
    retry: false,
  });
}

export function useEntireLogsQuery(repoPath: string, tailLines: number) {
  return useQuery<EntireLogResult>({
    queryKey: ["entire-logs", repoPath, tailLines],
    queryFn: () => invoke("get_entire_logs", { repoPath, tailLines }),
    enabled: !!repoPath,
    retry: false,
  });
}

export function useActiveSessionsQuery(repoPath: string) {
  return useQuery<SessionState[]>({
    queryKey: ["active-sessions", repoPath],
    queryFn: () => invoke("list_sessions", { repoPath }),
    enabled: !!repoPath,
    retry: false,
  });
}

export function useRawCheckpointMetadataQuery(repoPath: string, checkpointId: string) {
  return useQuery<string>({
    queryKey: ["raw-checkpoint-metadata", repoPath, checkpointId],
    queryFn: () => invoke("get_raw_checkpoint_metadata", { repoPath, checkpointId }),
    enabled: !!repoPath && !!checkpointId,
    retry: false,
  });
}

export function useRawSessionFileQuery(repoPath: string, sessionId: string) {
  return useQuery<string>({
    queryKey: ["raw-session-file", repoPath, sessionId],
    queryFn: () => invoke("get_raw_session_file", { repoPath, sessionId }),
    enabled: !!repoPath && !!sessionId,
    retry: false,
  });
}

export function useCheckpointLogsQuery(
  repoPath: string,
  checkpointId: string,
  sessionIds: string[]
) {
  return useQuery<EntireLogResult>({
    queryKey: ["checkpoint-logs", repoPath, checkpointId, sessionIds],
    queryFn: () => invoke("get_checkpoint_logs", { repoPath, checkpointId, sessionIds }),
    enabled: !!repoPath && !!checkpointId,
    retry: false,
  });
}

export function useRegisterRepoMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (path: string) => invoke("register_repo", { path }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useUnregisterRepoMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (path: string) => invoke("unregister_repo", { path }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useHideRepoMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (path: string) => invoke("hide_repo", { path }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useCreateWorktreeMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { repoPath: string; options: CreateWorktreeOptions }>({
    mutationFn: ({ repoPath, options }) =>
      invoke("create_worktree", {
        repoPath,
        mode: options.mode,
        branchName: options.branchName,
        targetPath: options.targetPath,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useDeleteWorktreeMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { repoPath: string; options: DeleteWorktreeOptions }>({
    mutationFn: ({ repoPath, options }) =>
      invoke("delete_worktree", {
        repoPath,
        worktreePath: options.worktreePath,
        branchName: options.branchName,
        force: options.force,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useDeleteBranchMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { repoPath: string; branchName: string }>({
    mutationFn: ({ repoPath, branchName }) =>
      invoke("delete_branch", {
        repoPath,
        branchName,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useBranchTranscriptsQuery(
  repoPath: string,
  branch: string,
  enabled: boolean
) {
  const { data: checkpoints } = useCheckpointsQuery(repoPath, branch);

  const queries = useQueries({
    queries: (checkpoints ?? []).map((cp) => ({
      queryKey: ["transcript", repoPath, cp.checkpoint_id, 0] as const,
      queryFn: () =>
        invoke<TranscriptMessage[]>("get_transcript", {
          repoPath,
          checkpointId: cp.checkpoint_id,
          sessionIndex: 0,
        }),
      enabled: enabled && !!repoPath && !!cp.checkpoint_id,
      retry: false,
    })),
  });

  return { checkpoints: checkpoints ?? [], queries };
}
