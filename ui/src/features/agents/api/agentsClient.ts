/**
 * Agents Control Center client.
 *
 * Two rules govern this file:
 *
 *  1. It parses the AUTHORITATIVE payload (`AgentView`). Anything it cannot
 *     recognise is dropped rather than invented — an unrecognised field must
 *     not become a plausible-looking default.
 *
 *  2. It NEVER substitutes sample data for a real answer. The previous version
 *     silently returned twelve invented agents whenever the route was
 *     unconfigured, returned 404, returned an empty list, or hit a server
 *     error in DEV. Every one of those cases is a different fact, and showing
 *     a fabricated roster for any of them is exactly the failure this layer
 *     exists to prevent. Sample data is now opt-in and explicitly labelled.
 */
import { apiRequest, type ApiRequestOptions } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type {
  AgentAdministrativeStatus,
  AgentInstanceState,
  AgentListItem,
  AgentStatus,
  AgentsClientErrorCode,
  AgentsSnapshot,
  SpecialistPolicies,
} from "./agentsTypes";
import { getDevelopmentAgentsFallback } from "./agentsDevelopmentData";

/**
 * The route is a BUILD-TIME constant: Vite inlines `import.meta.env`, so this
 * cannot be reconfigured at runtime. The consequence matters for correctness —
 * an unconfigured route is a permanent, visible fact about this build, not a
 * transient error, which is why it is reported as its own state.
 */
const BUILD_AGENTS_PATH: string = import.meta.env.VITE_AGENTS_PATH ?? "";

export interface AgentsClientDeps {
  /** Defaults to the build-time route. Pass "" to exercise the unconfigured case. */
  path?: string;
  /** Defaults to the shared Control Plane transport. */
  request?: <T>(path: string, options: ApiRequestOptions) => Promise<T>;
}

export class AgentsClientError extends Error {
  readonly code: AgentsClientErrorCode;
  readonly retryable: boolean;

  constructor(code: AgentsClientErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "AgentsClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The operational axis, as the Control Plane reports it. */
function normalizeStatus(value: unknown): AgentStatus {
  switch (value) {
    case "active":
    case "idle":
    case "paused":
    case "offline":
    case "error":
    case "provisioning":
      return value;
    default:
      // A status the Control Plane did not send is UNKNOWN, not "active".
      return "unknown";
  }
}

function normalizeAdministrativeStatus(value: unknown): AgentAdministrativeStatus {
  switch (value) {
    case "draft":
    case "active":
    case "suspended":
    case "disabled":
    case "retired":
      return value;
    default:
      return "draft";
  }
}

function normalizeInstanceState(value: unknown): AgentInstanceState {
  switch (value) {
    case "available":
    case "assigned":
    case "busy":
    case "waiting":
    case "blocked":
    case "offline":
      return value;
    default:
      return "offline";
  }
}

function normalizeSpecialist(value: unknown): SpecialistPolicies | undefined {
  if (!isRecord(value)) return undefined;
  const toolPolicy = isRecord(value.toolPolicy) ? value.toolPolicy : undefined;
  const reviewPolicy = isRecord(value.reviewPolicy) ? value.reviewPolicy : undefined;
  const projectPolicy = isRecord(value.projectPolicy) ? value.projectPolicy : undefined;
  const modelPolicy = isRecord(value.modelPolicy) ? value.modelPolicy : undefined;
  if (!toolPolicy || !reviewPolicy || !projectPolicy || !modelPolicy) return undefined;

  return {
    descriptorVersion: num(value.descriptorVersion),
    displayName: str(value.displayName) ?? "",
    department: str(value.department) ?? "",
    description: str(value.description) ?? "",
    limitations: strArray(value.limitations),
    administrativeStatus: normalizeAdministrativeStatus(value.administrativeStatus),
    operationalState: normalizeInstanceState(value.operationalState),
    supportedTaskTypes: strArray(value.supportedTaskTypes),
    projectPolicy: { mode: "allow_list", projects: strArray(projectPolicy.projects) },
    toolPolicy: {
      maxExecutionCapabilities: strArray(toolPolicy.maxExecutionCapabilities),
      deniedExecutionCapabilities: strArray(toolPolicy.deniedExecutionCapabilities),
      // An absent flag is treated as `true` (i.e. fail closed): an agent whose
      // shell authority the Control Plane did not confirm is shown as having
      // none.
      allowsUnrestrictedShell: toolPolicy.allowsUnrestrictedShell === true,
    },
    riskCeiling: str(value.riskCeiling) ?? "unknown",
    reviewPolicy: {
      requiresIndependentReview: reviewPolicy.requiresIndependentReview === true,
      minimumReviewers: num(reviewPolicy.minimumReviewers),
      selfReviewAllowed: false,
    },
    modelPolicy: {
      provider: str(modelPolicy.provider) ?? "unscoped",
      model: str(modelPolicy.model),
    },
    instanceCount: num(value.instanceCount),
    currentAssignmentId: str(value.currentAssignmentId),
    currentTaskId: str(value.currentTaskId),
  };
}

function normalizeAgent(value: unknown): AgentListItem | null {
  if (!isRecord(value)) return null;
  const id = str(value.agentId);
  // An agent with no id cannot be acted on, so it is not rendered at all.
  if (!id) return null;
  const stats = isRecord(value.stats) ? value.stats : undefined;

  return {
    id,
    name: str(value.name) ?? id,
    description: str(value.description),
    status: normalizeStatus(value.status),
    capabilities: strArray(value.capabilities),
    enabled: value.enabled === true,
    disabledReason: str(value.disabledReason),
    currentTaskId: str(value.currentTaskId),
    currentProjectId: str(value.currentProjectId),
    allowedProjects: strArray(value.allowedProjects),
    lastActivityAt: str(value.lastActivityAt),
    taskCount: num(stats?.taskCount),
    completed: num(stats?.completed),
    failed: num(stats?.failed),
    specialist: normalizeSpecialist(value.specialist),
  };
}

function deriveSummary(agents: AgentListItem[]) {
  return {
    total: agents.length,
    active: agents.filter((agent) => agent.status === "active").length,
    idle: agents.filter((agent) => agent.status === "idle").length,
    offline: agents.filter((agent) => agent.status === "offline").length,
    specialists: agents.filter((agent) => agent.specialist).length,
    // "Accepting work" requires BOTH an active administrative status and no
    // operational disable. An agent that is running but suspended is not
    // accepting new work, and neither is one that is free but disabled.
    acceptingWork: agents.filter(
      (agent) =>
        agent.enabled &&
        (agent.specialist === undefined ||
          agent.specialist.administrativeStatus === "active"),
    ).length,
  };
}

function parseAgentsPayload(payload: unknown): AgentListItem[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => normalizeAgent(item))
      .filter((item): item is AgentListItem => item !== null);
  }
  if (!isRecord(payload)) return [];
  const data = isRecord(payload.data) ? payload.data : payload;
  const collection = Array.isArray(data.agents)
    ? data.agents
    : Array.isArray(data.items)
      ? data.items
      : [];
  return collection
    .map((item) => normalizeAgent(item))
    .filter((item): item is AgentListItem => item !== null);
}

export async function getAgentsSnapshot(
  accessToken?: string | null,
  deps: AgentsClientDeps = {},
): Promise<AgentsSnapshot> {
  const path = deps.path ?? BUILD_AGENTS_PATH;
  const request = deps.request ?? apiRequest;

  if (!path) {
    // Refuse rather than fabricate. An unconfigured route means the deployment
    // cannot tell you who its agents are; showing a sample roster would be a
    // guess presented as a fact.
    throw new AgentsClientError(
      "NOT_CONFIGURED",
      "The Agents Control Plane route is not configured for this deployment.",
      false,
    );
  }

  try {
    const payload = await request<unknown>(path, {
      method: "GET",
      accessToken,
    });
    const agents = parseAgentsPayload(payload);
    if (agents.length === 0) {
      // An empty roster is a real, meaningful answer: this deployment has no
      // agents registered. It is NOT the same as "the route is unavailable",
      // and it must not be filled in with sample data.
      return { agents, summary: deriveSummary(agents), authoritative: true, source: "control-plane" };
    }
    return {
      agents,
      summary: deriveSummary(agents),
      authoritative: true,
      source: "control-plane",
    };
  } catch (error) {
    if (error instanceof AgentsClientError) throw error;

    if (error instanceof ApiError) {
      const status = error.status ?? 0;
      if (status === 401 || status === 403) {
        throw new AgentsClientError(
          "UNAUTHORIZED",
          "You do not have permission to view the agent registry.",
          false,
        );
      }
      if (status === 404) {
        // "Not composed" and "empty" are different facts and are reported as
        // different states, because only one of them means this deployment has
        // no specialists at all.
        throw new AgentsClientError(
          "NOT_COMPOSED",
          "This deployment does not expose a specialist workforce.",
          false,
        );
      }
      if (status >= 500) {
        throw new AgentsClientError(
          "DEGRADED",
          "The agent registry is temporarily unavailable.",
          true,
        );
      }
      throw new AgentsClientError(
        "NETWORK",
        "Unable to retrieve the agent registry from the Control Plane.",
        true,
      );
    }

    throw new AgentsClientError(
      "NETWORK",
      "Unable to communicate with the Control Plane API.",
      true,
    );
  }
}

/**
 * Explicitly-labelled sample data, for local UI work only.
 *
 * Reachable ONLY through this function. It is never returned automatically,
 * and the snapshot it produces is marked `authoritative: false` so a consumer
 * can refuse to present it as a real roster.
 */
export function getSampleAgentsSnapshot(): AgentsSnapshot {
  const agents = getDevelopmentAgentsFallback().agents;
  return {
    agents,
    summary: deriveSummary(agents),
    authoritative: false,
    source: "development-sample",
  };
}
