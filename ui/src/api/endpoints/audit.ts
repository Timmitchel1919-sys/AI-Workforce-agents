import type { ApiClient } from "../client";
import type { AuditEventQuery, AuditEventView, PageResult } from "../contracts";
import type { ApiQuery } from "../types";

export type AuditListFilters = Pick<
  AuditEventQuery,
  | "type"
  | "agentId"
  | "projectId"
  | "taskId"
  | "workflowId"
  | "toolId"
  | "actor"
  | "correlationId"
  | "outcome"
  | "since"
  | "until"
  | "limit"
  | "cursor"
>;

export function listAudit(client: ApiClient, filters: AuditListFilters = {}) {
  return client
    .get<PageResult<AuditEventView>>("/audit", { query: filters as ApiQuery })
    .then((r) => r.data);
}
