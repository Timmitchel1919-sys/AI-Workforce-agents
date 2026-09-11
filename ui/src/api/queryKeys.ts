/**
 * Centralized, structured TanStack Query keys. Every server-state query keys off
 * these — never an inline string — so cache invalidation stays reliable.
 *
 *   queryKeys.agents.all           → invalidates every agents query
 *   queryKeys.agents.list(filters) → one filtered list
 *   queryKeys.agents.detail(id)    → one agent
 */
import type { TaskListFilters } from "./endpoints/tasks";
import type { AuditListFilters } from "./endpoints/audit";
import type { ApprovalListFilters } from "./endpoints/approvals";

export const queryKeys = {
  system: {
    all: ["system"] as const,
    liveness: ["system", "liveness"] as const,
    health: ["system", "health"] as const,
    apiStatus: ["system", "api-status"] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    snapshot: ["dashboard", "snapshot"] as const,
    status: ["dashboard", "status"] as const,
  },
  agents: {
    all: ["agents"] as const,
    lists: ["agents", "list"] as const,
    list: () => ["agents", "list"] as const,
    detail: (id: string) => ["agents", "detail", id] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    lists: ["tasks", "list"] as const,
    list: (filters?: TaskListFilters) =>
      ["tasks", "list", filters ?? {}] as const,
    detail: (id: string) => ["tasks", "detail", id] as const,
  },
  workflows: {
    all: ["workflows"] as const,
    lists: ["workflows", "list"] as const,
    list: () => ["workflows", "list"] as const,
    detail: (id: string) => ["workflows", "detail", id] as const,
  },
  projects: {
    all: ["projects"] as const,
    lists: ["projects", "list"] as const,
    list: () => ["projects", "list"] as const,
    detail: (id: string) => ["projects", "detail", id] as const,
  },
  approvals: {
    all: ["approvals"] as const,
    lists: ["approvals", "list"] as const,
    list: (filters?: ApprovalListFilters) =>
      ["approvals", "list", filters ?? {}] as const,
  },
  audit: {
    all: ["audit"] as const,
    lists: ["audit", "list"] as const,
    list: (filters?: AuditListFilters) =>
      ["audit", "list", filters ?? {}] as const,
  },
  tools: {
    all: ["tools"] as const,
    lists: ["tools", "list"] as const,
    list: () => ["tools", "list"] as const,
    detail: (id: string) => ["tools", "detail", id] as const,
  },
} as const;
