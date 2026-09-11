import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { tasksApi, invalidateForCommand } from "../../api";

type TaskInput = Parameters<typeof tasksApi.cancelTask>[1];

export function useCancelTask() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskInput) => tasksApi.cancelTask(client, input),
    onSuccess: (_result, input) =>
      invalidateForCommand(qc, "cancel-task", { taskId: input.taskId }),
  });
}

export function useRetryTask() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskInput) => tasksApi.retryTask(client, input),
    onSuccess: (_result, input) =>
      invalidateForCommand(qc, "retry-task", { taskId: input.taskId }),
  });
}
