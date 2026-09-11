/**
 * Agents module — UI view-model + pure derivation helpers.
 *
 * The Control Plane owns the authoritative shape (`AgentView` in
 * `contracts/control.ts`). This module maps it to a flat, presentation-oriented
 * `AgentListItem` and provides the pure search / filter / sort / summary
 * functions the page composes. No React, no data fetching, no backend fields
 * are invented — every value here is derived from `AgentView`.
 */
import type { AgentOperationalStatus, AgentView } from "../../api/contracts";

/** Every operational status the backend can report (mirrors the contract). */
export const AGENT_STATUSES = [
  "idle",
  "available",
  "busy",
  "blocked",
  "waiting",
  "failed",
  "disabled",
] as const satisfies readonly AgentOperationalStatus[];

/** Flat, presentation-oriented projection of one `AgentView`. */
export interface AgentListItem {
  id: string;
  name: string;
  role: string;
  status: AgentOperationalStatus;
  enabled: boolean;
  disabledReason?: string;
  capabilities: readonly string[];
  currentTaskId?: string;
  currentProjectId?: string;
  allowedProjects: readonly string[];
  lastActivityAt?: string;
  /** From `AgentView.stats` — real counters, never fabricated. */
  taskCount: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
}

export function toAgentListItem(agent: AgentView): AgentListItem {
  return {
    id: agent.agentId,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    enabled: agent.enabled,
    disabledReason: agent.disabledReason,
    capabilities: agent.capabilities,
    currentTaskId: agent.currentTaskId,
    currentProjectId: agent.currentProjectId,
    allowedProjects: agent.allowedProjects,
    lastActivityAt: agent.lastActivityAt,
    taskCount: agent.stats.taskCount,
    completed: agent.stats.completed,
    failed: agent.stats.failed,
    cancelled: agent.stats.cancelled,
    successRate: agent.stats.successRate,
  };
}

export function toAgentListItems(
  agents: readonly AgentView[],
): AgentListItem[] {
  return agents.map(toAgentListItem);
}

/* ---- Filters --------------------------------------------------------- */

export type StatusFilter = AgentOperationalStatus | "all";

export interface AgentFilters {
  /** Free-text: matches name, role, id, capabilities. */
  search: string;
  status: StatusFilter;
  /** A capability string, or `"all"`. */
  capability: string;
  /** A project id, or `"all"`. */
  project: string;
}

export const EMPTY_FILTERS: AgentFilters = {
  search: "",
  status: "all",
  capability: "all",
  project: "all",
};

export function filtersActive(filters: AgentFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.status !== "all" ||
    filters.capability !== "all" ||
    filters.project !== "all"
  );
}

function matchesSearch(item: AgentListItem, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  if (item.name.toLowerCase().includes(q)) return true;
  if (item.role.toLowerCase().includes(q)) return true;
  if (item.id.toLowerCase().includes(q)) return true;
  return item.capabilities.some((c) => c.toLowerCase().includes(q));
}

function agentInProject(item: AgentListItem, projectId: string): boolean {
  if (item.currentProjectId === projectId) return true;
  if (item.allowedProjects.includes("*")) return true;
  return item.allowedProjects.includes(projectId);
}

export function filterAgents(
  items: readonly AgentListItem[],
  filters: AgentFilters,
): AgentListItem[] {
  return items.filter((item) => {
    if (!matchesSearch(item, filters.search)) return false;
    if (filters.status !== "all" && item.status !== filters.status) {
      return false;
    }
    if (
      filters.capability !== "all" &&
      !item.capabilities.includes(filters.capability)
    ) {
      return false;
    }
    if (filters.project !== "all" && !agentInProject(item, filters.project)) {
      return false;
    }
    return true;
  });
}

/** Sorted, de-duplicated capability strings present in the dataset. */
export function collectCapabilities(items: readonly AgentListItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const c of item.capabilities) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Sorted, de-duplicated concrete project ids present in the dataset. */
export function collectProjects(items: readonly AgentListItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.currentProjectId) set.add(item.currentProjectId);
    for (const p of item.allowedProjects) {
      if (p !== "*") set.add(p);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/* ---- Sorting ------------------------------------------------------- */

export type AgentSortColumn = "name" | "status" | "tasks" | "updated";
export type SortDir = "asc" | "desc";

export interface AgentSort {
  column: AgentSortColumn;
  direction: SortDir;
}

export const DEFAULT_SORT: AgentSort = { column: "name", direction: "asc" };

function compare(
  a: AgentListItem,
  b: AgentListItem,
  column: AgentSortColumn,
): number {
  switch (column) {
    case "name":
      return a.name.localeCompare(b.name);
    case "status":
      return a.status.localeCompare(b.status);
    case "tasks":
      return a.taskCount - b.taskCount;
    case "updated": {
      const at = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
      const bt = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
      return at - bt;
    }
    default:
      return 0;
  }
}

export function sortAgents(
  items: readonly AgentListItem[],
  sort: AgentSort,
): AgentListItem[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const primary = compare(a, b, sort.column) * factor;
    return primary !== 0 ? primary : a.name.localeCompare(b.name);
  });
}

/* ---- Summary ----------------------------------------------------- */

export interface AgentsSummary {
  total: number;
  /** Ready to pick up work. */
  available: number;
  /** Actively running a task. */
  busy: number;
  idle: number;
  /** `blocked` + `failed` — needs an operator's attention. */
  attention: number;
  /** Operationally disabled (control-plane flag or `disabled` status). */
  disabled: number;
  byStatus: Record<AgentOperationalStatus, number>;
}

export function summarize(items: readonly AgentListItem[]): AgentsSummary {
  const byStatus = {
    idle: 0,
    available: 0,
    busy: 0,
    blocked: 0,
    waiting: 0,
    failed: 0,
    disabled: 0,
  } satisfies Record<AgentOperationalStatus, number>;

  let disabled = 0;
  for (const item of items) {
    byStatus[item.status] += 1;
    if (!item.enabled || item.status === "disabled") disabled += 1;
  }

  return {
    total: items.length,
    available: byStatus.available,
    busy: byStatus.busy,
    idle: byStatus.idle,
    attention: byStatus.blocked + byStatus.failed,
    disabled,
    byStatus,
  };
}

/** `0.42` → `"42%"`; `null` → `"—"`. */
export function formatSuccessRate(rate: number | null): string {
  if (rate === null || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}
