import { useMemo } from "react";
import { useApprovals } from "../../features/approvals";
import { findPendingApprovalForTask } from "./governance";

/**
 * Governance data boundary (UI-5E):
 *
 *   AgentGovernanceCard → useAgentGovernance(currentTaskId) → useApprovals()
 *     → approvalsApi.listApprovals() → ApiClient → Control Plane
 *
 * A distinct data source from `useAgentAuditEvents` (approvals vs. audit),
 * so a failure here never affects the Audit Summary section or the rest of
 * Agent Detail — independent loading/error, as required.
 */
export function useAgentGovernance(currentTaskId: string | undefined) {
  const query = useApprovals({ status: "requested" });

  const pendingApproval = useMemo(
    () =>
      query.data ? findPendingApprovalForTask(query.data, currentTaskId) : null,
    [query.data, currentTaskId],
  );

  return { ...query, pendingApproval };
}
