import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { approvalsApi, invalidateForCommand } from "../../api";
import type { ControlCommandResult } from "../../api/contracts";

type ApproveInput = Parameters<typeof approvalsApi.approve>[1];
type RejectInput = Parameters<typeof approvalsApi.reject>[1];

/**
 * Approval commands are operationally sensitive. These mutations expose full
 * `isPending` / `isError` / `data` state; the future UI wraps them in a
 * confirmation + risk indication. No optimistic state — the server-confirmed
 * `ControlCommandResult` is authoritative, and affected queries are refetched.
 */
export function useApproveApproval() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation<ControlCommandResult, unknown, ApproveInput>({
    mutationFn: (input) => approvalsApi.approve(client, input),
    onSuccess: (result) =>
      invalidateForCommand(qc, "approve", {
        taskId: stringDetail(result, "taskId"),
        workflowId: stringDetail(result, "workflowId"),
      }),
  });
}

export function useRejectApproval() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation<ControlCommandResult, unknown, RejectInput>({
    mutationFn: (input) => approvalsApi.reject(client, input),
    onSuccess: (result) =>
      invalidateForCommand(qc, "reject", {
        taskId: stringDetail(result, "taskId"),
        workflowId: stringDetail(result, "workflowId"),
      }),
  });
}

function stringDetail(
  result: ControlCommandResult,
  key: string,
): string | undefined {
  const value = (result.details as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : undefined;
}
