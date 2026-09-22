import { apiRequest } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import type {
  AgentExecutionItem,
  AgentHealth,
  AgentListItem,
  AgentStatus,
  AgentsSnapshot,
} from "./agentsTypes";
import { getDevelopmentAgentsFallback } from "./agentsDevelopmentData";

const AGENTS_PATH = import.meta.env.VITE_AGENTS_PATH;

export class AgentsClientError extends Error {
  readonly code: "UNAUTHORIZED" | "DEGRADED" | "EMPTY" | "NETWORK";
  readonly retryable: boolean;

  constructor(
    code: "UNAUTHORIZED" | "DEGRADED" | "EMPTY" | "NETWORK",
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "AgentsClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeStatus(value: unknown): AgentStatus {
  if (value === "active" || value === "idle" || value === "paused" || value === "offline" || value === "error" || value === "provisioning") {
    return value;
  }

  return "unknown";
}

function normalizeHealth(value: unknown): AgentHealth | undefined {
  if (value === "healthy" || value === "degraded" || value === "critical" || value === "unavailable") {
    return value;
  }

  return undefined;
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item : String(item)))
    .filter(Boolean);
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function normalizeExecutions(value: unknown): AgentExecutionItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items: AgentExecutionItem[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const id = typeof item.id === "string" ? item.id : "execution";
    const name = typeof item.name === "string" ? item.name : "Execution";
    const status = item.status === "running" || item.status === "completed" || item.status === "failed" || item.status === "pending" ? item.status : "pending";
    const startedAt = typeof item.startedAt === "string" ? item.startedAt : undefined;
    const duration = typeof item.duration === "string" ? item.duration : undefined;
    const task = typeof item.task === "string" ? item.task : undefined;
    const result = typeof item.result === "string" ? item.result : undefined;

    items.push({
      id,
      name,
      status,
      startedAt,
      duration,
      task,
      result,
    });
  }

  return items;
}

function normalizeAgent(value: unknown): AgentListItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id : "agent-unknown";
  const name = typeof value.name === "string" ? value.name : "Unnamed Agent";
  const description = typeof value.description === "string" ? value.description : undefined;
  const status = normalizeStatus(value.status);
  const model = typeof value.model === "string" ? value.model : undefined;
  const capabilities = normalizeCapabilities(value.capabilities);
  const activeTasks = normalizeNumber(value.activeTasks);
  const health = normalizeHealth(value.health);
  const projectId = typeof value.projectId === "string" ? value.projectId : undefined;
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : undefined;

  return {
    id,
    name,
    description,
    status,
    model,
    capabilities,
    activeTasks,
    health,
    projectId,
    updatedAt,
    recentExecutions: normalizeExecutions(value.recentExecutions),
  };
}

function deriveSummary(agents: AgentListItem[]) {
  return {
    total: agents.length,
    active: agents.filter((agent) => agent.status === "active").length,
    idle: agents.filter((agent) => agent.status === "idle").length,
    offline: agents.filter((agent) => agent.status === "offline").length,
    healthy: agents.filter((agent) => agent.health === "healthy").length,
  };
}

function parseAgentsPayload(payload: unknown): AgentListItem[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => normalizeAgent(item))
      .filter((item): item is AgentListItem => item !== null);
  }

  if (!isRecord(payload)) {
    return [];
  }

  const dataCandidate = isRecord(payload.data) ? payload.data : payload;

  const collection = Array.isArray(dataCandidate.agents)
    ? dataCandidate.agents
    : Array.isArray(dataCandidate.items)
      ? dataCandidate.items
      : Array.isArray(dataCandidate.results)
        ? dataCandidate.results
        : [];

  return collection
    .map((item) => normalizeAgent(item))
    .filter((item): item is AgentListItem => item !== null);
}

export async function getAgentsSnapshot(accessToken?: string | null): Promise<AgentsSnapshot> {
  if (!AGENTS_PATH) {
    if (import.meta.env.DEV) {
      return getDevelopmentAgentsFallback();
    }

    throw new AgentsClientError(
      "NETWORK",
      "The Agents Control Plane route is not configured.",
      true,
    );
  }

  try {
    const payload = await apiRequest<unknown>(AGENTS_PATH, {
      method: "GET",
      accessToken,
    });

    const agents = parseAgentsPayload(payload);
    if (agents.length === 0) {
      if (import.meta.env.DEV) {
        return getDevelopmentAgentsFallback();
      }

      throw new AgentsClientError("EMPTY", "No agents are available from the Control Plane.", false);
    }

    return {
      agents,
      summary: deriveSummary(agents),
    };
  } catch (error) {
    if (error instanceof AgentsClientError) {
      throw error;
    }

    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        throw new AgentsClientError(
          "UNAUTHORIZED",
          "You do not have permission to view the agent registry.",
          false,
        );
      }

      if (error.status === 404) {
        if (import.meta.env.DEV) {
          return getDevelopmentAgentsFallback();
        }

        throw new AgentsClientError(
          "NETWORK",
          "The Agents Control Plane resource is not available.",
          true,
        );
      }

      if (error.status === 503 || error.status === 502 || error.status === 500) {
        throw new AgentsClientError(
          "DEGRADED",
          "The agent registry is temporarily unavailable. Some information may be incomplete.",
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
