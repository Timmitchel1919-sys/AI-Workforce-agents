import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { workflowsApi, invalidateForCommand } from "../../api";

type WorkflowInput = Parameters<typeof workflowsApi.pauseWorkflow>[1];

export function usePauseWorkflow() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkflowInput) =>
      workflowsApi.pauseWorkflow(client, input),
    onSuccess: (_result, input) =>
      invalidateForCommand(qc, "pause-workflow", {
        workflowId: input.workflowId,
      }),
  });
}

export function useResumeWorkflow() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkflowInput) =>
      workflowsApi.resumeWorkflow(client, input),
    onSuccess: (_result, input) =>
      invalidateForCommand(qc, "resume-workflow", {
        workflowId: input.workflowId,
      }),
  });
}

export function useCancelWorkflow() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkflowInput) =>
      workflowsApi.cancelWorkflow(client, input),
    onSuccess: (_result, input) =>
      invalidateForCommand(qc, "cancel-workflow", {
        workflowId: input.workflowId,
      }),
  });
}
