import { useMemo } from "react";
import { useAuditEvents } from "../../features/audit";
import { pairExecutions } from "./executions";

/**
 * Agent Detail's execution data boundary:
 *
 *   AgentDetailPage → useAgentExecutions(agentId) → useAuditEvents()
 *     → auditApi.listAudit() → ApiClient → Control Plane
 *
 * There is no dedicated executions endpoint (see `executions.ts`), so this
 * composes the existing, already-established `useAuditEvents` query — never
 * a second fetch mechanism — and derives paired `AgentExecutionView[]` from
 * the real audit events it returns. Cursor pagination is the same opaque
 * cursor `GET /api/audit` already supports; the caller (the page) owns the
 * "current page" UI state and passes `cursor` in.
 */
export function useAgentExecutions(
  agentId: string | undefined,
  options: { limit?: number; cursor?: string; currentTaskId?: string } = {},
) {
  const query = useAuditEvents({
    agentId,
    limit: options.limit ?? 50,
    cursor: options.cursor,
  });

  const executions = useMemo(
    () =>
      query.data ? pairExecutions(query.data.items, options.currentTaskId) : [],
    [query.data, options.currentTaskId],
  );

  return {
    ...query,
    executions,
    nextCursor: query.data?.nextCursor ?? null,
  };
}
