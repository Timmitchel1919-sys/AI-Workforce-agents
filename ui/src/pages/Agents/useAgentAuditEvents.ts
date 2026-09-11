import { useMemo } from "react";
import { useAuditEvents } from "../../features/audit";
import { isGovernanceEvent } from "./governance";

const AUDIT_SUMMARY_LIMIT = 30;

/**
 * Contextual governance-activity boundary for Agent Detail (UI-5E):
 *
 *   AgentAuditSummary → useAgentAuditEvents(agentId) → useAuditEvents()
 *     → auditApi.listAudit() → ApiClient → Control Plane
 *
 * Same underlying primitive as `useAgentExecutions` (both read `/api/audit`),
 * filtered to a different, non-overlapping event-type subset — this is not
 * the global Audit Log (`/audit`), only a bounded, agent-scoped summary.
 */
export function useAgentAuditEvents(agentId: string | undefined) {
  const query = useAuditEvents({ agentId, limit: AUDIT_SUMMARY_LIMIT });

  const events = useMemo(
    () =>
      query.data
        ? query.data.items.filter((e) => isGovernanceEvent(e.type))
        : [],
    [query.data],
  );

  return { ...query, events };
}
