import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApiClient } from "../../app/providers/apiContext";
import { tasksApi, invalidateForCommand } from "../../api";
import type { ControlCommandResult } from "../../api/contracts";

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

/**
 * The complete set of task lifecycle commands exposed by the Control Plane.
 * There is intentionally no pause, resume, reassign, priority, or delete
 * action here because the backend does not implement a corresponding command.
 */
export type TaskAction = "cancel" | "retry";
export type TaskActionStatus = "idle" | "pending" | "success" | "error";

/**
 * Uniform, Control-Plane-only mutation surface for Task actions. Successful
 * commands invalidate affected server state; this hook never patches a Task
 * into the cache or pretends the lifecycle changed locally.
 */
export function useTaskActions() {
  const cancel = useCancelTask();
  const retry = useRetryTask();
  const [lastAction, setLastAction] = useState<TaskAction | null>(null);

  const active =
    lastAction === "cancel" ? cancel : lastAction === "retry" ? retry : null;
  const status: TaskActionStatus = useMemo(() => {
    if (!active) return "idle";
    if (active.isPending) return "pending";
    if (active.isSuccess) return "success";
    if (active.isError) return "error";
    return "idle";
  }, [active]);

  async function execute(
    action: TaskAction,
    input: TaskInput,
  ): Promise<ControlCommandResult> {
    setLastAction(action);
    return (action === "cancel" ? cancel : retry).mutateAsync(input);
  }

  function reset() {
    cancel.reset();
    retry.reset();
    setLastAction(null);
  }

  return { execute, status, error: active?.error ?? null, reset };
}
