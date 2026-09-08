import type { ApiClient } from "../client";
import type { ApprovalView, ControlCommandResult } from "../contracts";
import type { ApiQuery } from "../types";

export interface ApprovalListFilters {
  status?: string;
}

export function listApprovals(
  client: ApiClient,
  filters: ApprovalListFilters = {},
) {
  return client
    .get<ApprovalView[]>("/approvals", { query: filters as ApiQuery })
    .then((r) => r.data);
}

export interface ApproveInput {
  approvalId: string;
  note?: string;
}

export interface RejectInput {
  approvalId: string;
  reason: string;
}

export function approve(client: ApiClient, input: ApproveInput) {
  return client
    .post<ControlCommandResult>("/commands/approve", input)
    .then((r) => r.data);
}

export function reject(client: ApiClient, input: RejectInput) {
  return client
    .post<ControlCommandResult>("/commands/reject", input)
    .then((r) => r.data);
}
