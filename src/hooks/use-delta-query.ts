import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  DeltaMetadata,
  TaskDAG,
  TaskState,
  DeltaEvent,
} from "../features/delta/types";

export function useDeltaListQuery() {
  return useQuery<DeltaMetadata[]>({
    queryKey: ["deltas"],
    queryFn: () => invoke("delta_list"),
    retry: false,
  });
}

export function useDeltaQuery(deltaId: string | null) {
  return useQuery<DeltaMetadata>({
    queryKey: ["delta", deltaId],
    queryFn: () => invoke("delta_get", { deltaId }),
    enabled: !!deltaId,
    retry: false,
  });
}

export function useDeltaPlanQuery(deltaId: string | null) {
  return useQuery<string>({
    queryKey: ["delta-plan", deltaId],
    queryFn: () => invoke("delta_get_plan", { deltaId }),
    enabled: !!deltaId,
    retry: false,
  });
}

export function useDeltaDAGQuery(deltaId: string | null) {
  return useQuery<TaskDAG | null>({
    queryKey: ["delta-dag", deltaId],
    queryFn: () => invoke("delta_get_dag", { deltaId }),
    enabled: !!deltaId,
    retry: false,
  });
}

export function useDeltaTasksQuery(deltaId: string | null) {
  return useQuery<TaskState[]>({
    queryKey: ["delta-tasks", deltaId],
    queryFn: () => invoke("delta_get_tasks", { deltaId }),
    enabled: !!deltaId,
    retry: false,
  });
}

export function useDeltaEventsQuery(deltaId: string | null) {
  return useQuery<DeltaEvent[]>({
    queryKey: ["delta-events", deltaId],
    queryFn: () => invoke("delta_get_events", { deltaId }),
    enabled: !!deltaId,
    retry: false,
  });
}

export function useCreateDeltaMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    DeltaMetadata,
    Error,
    { name: string; repos: { path: string; role: string }[]; description?: string }
  >({
    mutationFn: (args) => invoke("delta_create", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deltas"] });
    },
  });
}

export function useUpdateDeltaPlanMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { deltaId: string; content: string }>({
    mutationFn: (args) => invoke("delta_update_plan", args),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["delta-plan", variables.deltaId],
      });
    },
  });
}

export function useDeleteDeltaMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (deltaId: string) => invoke("delta_delete", { deltaId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deltas"] });
    },
  });
}

export function useApprovePlanMutation() {
  const queryClient = useQueryClient();
  return useMutation<TaskDAG, Error, string>({
    mutationFn: (deltaId: string) => invoke("delta_approve_plan", { deltaId }),
    onSuccess: (_data, deltaId) => {
      queryClient.invalidateQueries({ queryKey: ["delta", deltaId] });
      queryClient.invalidateQueries({ queryKey: ["delta-dag", deltaId] });
      queryClient.invalidateQueries({ queryKey: ["delta-tasks", deltaId] });
    },
  });
}

export function useAnswerQuestionMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { deltaId: string; questionId: string; answer: string; taskId: string }
  >({
    mutationFn: (args) => invoke("delta_answer_question", args),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["delta-events", variables.deltaId] });
      queryClient.invalidateQueries({ queryKey: ["delta-tasks", variables.deltaId] });
    },
  });
}

export function useCancelDeltaMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (deltaId: string) => invoke("delta_cancel", { deltaId }),
    onSuccess: (_data, deltaId) => {
      queryClient.invalidateQueries({ queryKey: ["delta", deltaId] });
      queryClient.invalidateQueries({ queryKey: ["delta-tasks", deltaId] });
      queryClient.invalidateQueries({ queryKey: ["deltas"] });
    },
  });
}
