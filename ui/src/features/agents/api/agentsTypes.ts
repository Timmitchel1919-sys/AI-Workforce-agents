/**
 * Types for the Agents Control Center, aligned to the AUTHORITATIVE API
 * shape (`AgentView` from `contracts/control.ts`).
 *
 * The previous types were invented to match a response the Control Plane never
 * produced (`id`, `name`, `status: "active" | "idle"`, `model`, `health`).
 * Parsing the real payload into invented fields is how a UI ends up showing
 * "Idle" for an agent that has no instance at all.
 *
 * The two status axes are kept separate on purpose, because collapsing them is
 * how a suspended agent keeps looking available:
 *
 *   ADMINISTRATIVE  may this agent receive NEW work at all?
 *   OPERATIONAL     what is it doing right now?
 *
 * Neither of them is QUALIFIED. Qualification is per-task evidence and lives
 * on the assignment — so it is deliberately absent from an agent row.
 */

export type AgentStatus =
  | "active"
  | "idle"
  | "paused"
  | "offline"
  | "error"
  | "provisioning"
  | "unknown";

/** `AgentAdministrativeStatus` — the static lifecycle of a descriptor. */
export type AgentAdministrativeStatus =
  | "draft"
  | "active"
  | "suspended"
  | "disabled"
  | "retired";

/** `AgentInstanceState` — what a running instance is doing. */
export type AgentInstanceState =
  | "available"
  | "assigned"
  | "busy"
  | "waiting"
  | "blocked"
  | "offline";

export type AgentHealth = "healthy" | "degraded" | "critical" | "unavailable";

/** The projected descriptor policies, exactly as the Control Plane reports them. */
export interface SpecialistPolicies {
  descriptorVersion: number;
  displayName: string;
  department: string;
  description: string;
  /** Stated in prose by the agent itself, shown verbatim. */
  limitations: string[];
  administrativeStatus: AgentAdministrativeStatus;
  operationalState: AgentInstanceState;
  supportedTaskTypes: string[];
  projectPolicy: { mode: "allow_list"; projects: string[] };
  toolPolicy: {
    maxExecutionCapabilities: string[];
    deniedExecutionCapabilities: string[];
    allowsUnrestrictedShell: boolean;
  };
  riskCeiling: string;
  reviewPolicy: {
    requiresIndependentReview: boolean;
    minimumReviewers: number;
    selfReviewAllowed: false;
  };
  modelPolicy: { provider: string; model?: string };
  instanceCount: number;
  currentAssignmentId?: string;
  currentTaskId?: string;
}

export interface AgentListItem {
  /** The stable agent id. Never a display name, never a role. */
  id: string;
  name: string;
  description?: string;
  status: AgentStatus;
  capabilities: string[];
  enabled: boolean;
  disabledReason?: string;
  currentTaskId?: string;
  currentProjectId?: string;
  allowedProjects: string[];
  lastActivityAt?: string;
  taskCount: number;
  completed: number;
  failed: number;
  /**
   * Present only for a full specialist descriptor. Its ABSENCE is meaningful:
   * the agent is a legacy flat agent with no qualification profile, policies or
   * limitations — not "an agent with no policies".
   */
  specialist?: SpecialistPolicies;
}

export interface AgentSummary {
  total: number;
  active: number;
  idle: number;
  offline: number;
  /** Agents that carry a full specialist descriptor. */
  specialists: number;
  /**
   * Agents that can receive new work RIGHT NOW. Deliberately not called
   * "available": administrative status and an instance both have to agree.
   */
  acceptingWork: number;
}

export interface AgentsSnapshot {
  agents: AgentListItem[];
  summary: AgentSummary;
  /**
   * True when the payload came from the Control Plane. A false value means the
   * data is explicitly-labelled sample data and must never be presented as
   * what this deployment actually runs.
   */
  authoritative: boolean;
  source: "control-plane" | "development-sample";
}

export type AgentsClientErrorCode =
  | "UNAUTHORIZED"
  | "DEGRADED"
  | "EMPTY"
  | "NETWORK"
  /** The specialist layer is not composed in this deployment. Distinct from EMPTY. */
  | "NOT_COMPOSED"
  | "NOT_CONFIGURED";
