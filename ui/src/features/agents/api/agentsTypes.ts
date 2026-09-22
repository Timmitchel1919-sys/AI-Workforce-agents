export type AgentStatus =
  | "active"
  | "idle"
  | "paused"
  | "offline"
  | "error"
  | "provisioning"
  | "unknown";

export type AgentHealth = "healthy" | "degraded" | "critical" | "unavailable";

export interface AgentExecutionItem {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "pending";
  startedAt?: string;
  duration?: string;
  task?: string;
  result?: string;
}

export interface AgentListItem {
  id: string;
  name: string;
  description?: string;
  status: AgentStatus;
  model?: string;
  capabilities: string[];
  activeTasks?: number;
  health?: AgentHealth;
  projectId?: string;
  updatedAt?: string;
  recentExecutions?: AgentExecutionItem[];
}

export interface AgentSummary {
  total: number;
  active: number;
  idle: number;
  offline: number;
  healthy: number;
}

export interface AgentsSnapshot {
  agents: AgentListItem[];
  summary: AgentSummary;
}

export type AgentsClientErrorCode = "UNAUTHORIZED" | "DEGRADED" | "EMPTY" | "NETWORK";
