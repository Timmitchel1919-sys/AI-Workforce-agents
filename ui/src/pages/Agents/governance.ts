/**
 * Agent governance — pure model (UI-5E).
 *
 * The frontend is not the security boundary; it only represents authorization
 * state the Control Plane already computed (`OperatorRole` → `ROLE_CAPABILITIES`
 * in `contracts/control.ts`, mirrored for UX in `auth/permissions.ts`). There is
 * no separate "agent permission", "policy", "environment", or "owner" model in
 * the backend — those concepts do not exist on `AgentView` or anywhere in
 * `contracts/`, so nothing here invents them.
 *
 * Approval correlation: `ApprovalView.agentId` is never populated by either
 * approval-creation path (`core/orchestrator/orchestrator.ts` and
 * `core/tools/tool-execution-engine.ts` both only attach `taskId` to approval
 * metadata), and `GET /api/approvals` has no `agentId` filter. The only real,
 * unfabricated correlation available is matching a pending approval's
 * `taskId` against this agent's own `currentTaskId`.
 */
import type { ApprovalView, OperatorRole } from "../../api/contracts";
import { can, type UiCapability } from "../../auth/permissions";
import { titleCase } from "../../lib/formatters";

/** Real, backend-governed capabilities relevant to the Agent Detail page. */
export interface GovernancePermission {
  capability: UiCapability;
  label: string;
  granted: boolean;
}

const GOVERNANCE_CAPABILITIES: ReadonlyArray<{
  capability: UiCapability;
  label: string;
}> = [
  { capability: "view", label: "View agent & executions" },
  { capability: "disable_agent", label: "Disable agent" },
  { capability: "enable_agent", label: "Enable agent" },
];

/** A hidden control does not mean the backend would deny it — this list is
 * UX guidance only, mirroring `ROLE_CAPABILITIES`. The Control Plane
 * re-authorizes every request independently. */
export function agentPermissions(
  role: OperatorRole | null | undefined,
): GovernancePermission[] {
  return GOVERNANCE_CAPABILITIES.map((c) => ({
    ...c,
    granted: can(role, c.capability),
  }));
}

/** The signed-in operator's own role, as the Control Plane issued it —
 * never an invented classification like "Read Only". */
export function accessLevelLabel(
  role: OperatorRole | null | undefined,
): string {
  return role ? titleCase(role) : "Unauthenticated";
}

export interface PendingAgentApproval {
  approvalId: string;
  action: string;
  risk: string;
  requestedBy: string;
  reason: string;
  requestedAt: string;
  taskId: string;
}

/** The one real, correlatable approval signal for an agent: a pending
 * approval whose `taskId` matches the agent's `currentTaskId`. */
export function findPendingApprovalForTask(
  approvals: readonly ApprovalView[],
  currentTaskId: string | undefined,
): PendingAgentApproval | null {
  if (!currentTaskId) return null;
  const match = approvals.find(
    (a) => a.taskId === currentTaskId && a.status === "requested",
  );
  if (!match) return null;
  return {
    approvalId: match.approvalId,
    action: match.action,
    risk: match.risk,
    requestedBy: match.requestedBy,
    reason: match.reason,
    requestedAt: match.requestedAt,
    taskId: currentTaskId,
  };
}

/**
 * Governance-relevant audit event types for the contextual Agent Audit
 * Summary — a bounded subset of `AUDIT_EVENT_TYPES`. `approval_decided` is
 * deliberately excluded: it is never recorded with an `agentId` (verified in
 * `core/orchestrator/orchestrator.ts` / `core/tools/tool-execution-engine.ts`),
 * so filtering by agent can never surface it — showing only the request half
 * of that pair would be misleading. The full decision trail lives in the
 * global Audit Log.
 */
export const GOVERNANCE_AUDIT_EVENT_TYPES: ReadonlySet<string> = new Set([
  "control_command",
  "approval_requested",
  "permission_decision",
]);

export function isGovernanceEvent(type: string): boolean {
  return GOVERNANCE_AUDIT_EVENT_TYPES.has(type);
}
