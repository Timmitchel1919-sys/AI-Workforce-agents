import { describe, expect, it } from "vitest";
import type { AgentView } from "../../../api/contracts";
import {
  AGENT_STATUSES,
  EMPTY_FILTERS,
  collectCapabilities,
  collectProjects,
  filterAgents,
  filtersActive,
  formatSuccessRate,
  sortAgents,
  summarize,
  toAgentListItems,
  DEFAULT_SORT,
} from "../agentsView";

function agent(over: Partial<AgentView> = {}): AgentView {
  return {
    agentId: "a1",
    name: "Research Agent",
    role: "research",
    capabilities: ["web_search", "summarize"],
    status: "available",
    enabled: true,
    allowedProjects: ["money-mind"],
    lastActivityAt: "2026-09-01T10:00:00.000Z",
    stats: {
      taskCount: 10,
      completed: 8,
      failed: 1,
      cancelled: 1,
      successRate: 0.8,
    },
    ...over,
  };
}

const DATASET = toAgentListItems([
  agent({ agentId: "a1", name: "Research Agent", status: "available" }),
  agent({
    agentId: "a2",
    name: "Finance Agent",
    role: "finance",
    status: "busy",
    capabilities: ["ledger"],
    currentProjectId: "money-mind",
    currentTaskId: "t-9",
    lastActivityAt: "2026-09-05T10:00:00.000Z",
    stats: {
      taskCount: 3,
      completed: 3,
      failed: 0,
      cancelled: 0,
      successRate: 1,
    },
  }),
  agent({
    agentId: "a3",
    name: "QA Agent",
    role: "qa",
    status: "failed",
    enabled: true,
    capabilities: ["web_search"],
    allowedProjects: ["*"],
    lastActivityAt: undefined,
    stats: {
      taskCount: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      successRate: null,
    },
  }),
  agent({
    agentId: "a4",
    name: "Ops Agent",
    role: "ops",
    status: "disabled",
    enabled: false,
    disabledReason: "maintenance",
    capabilities: [],
    allowedProjects: [],
    lastActivityAt: undefined,
    stats: {
      taskCount: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      successRate: null,
    },
  }),
]);

describe("agentsView — mapping", () => {
  it("projects AgentView onto a flat list item", () => {
    const [item] = toAgentListItems([agent()]);
    expect(item).toMatchObject({
      id: "a1",
      name: "Research Agent",
      role: "research",
      status: "available",
      taskCount: 10,
      completed: 8,
      failed: 1,
      successRate: 0.8,
    });
  });

  it("exposes exactly the contract's operational statuses", () => {
    expect([...AGENT_STATUSES]).toEqual([
      "idle",
      "available",
      "busy",
      "blocked",
      "waiting",
      "failed",
      "disabled",
    ]);
  });
});

describe("agentsView — filtering", () => {
  it("no filters returns everything", () => {
    expect(filterAgents(DATASET, EMPTY_FILTERS)).toHaveLength(4);
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
  });

  it("search matches name, role, id, and capability", () => {
    expect(
      filterAgents(DATASET, { ...EMPTY_FILTERS, search: "finance" }),
    ).toHaveLength(1);
    expect(
      filterAgents(DATASET, { ...EMPTY_FILTERS, search: "a3" }),
    ).toHaveLength(1);
    expect(
      filterAgents(DATASET, { ...EMPTY_FILTERS, search: "web_search" }).map(
        (a) => a.id,
      ),
    ).toEqual(["a1", "a3"]);
  });

  it("status filter is exact", () => {
    const failed = filterAgents(DATASET, {
      ...EMPTY_FILTERS,
      status: "failed",
    });
    expect(failed.map((a) => a.id)).toEqual(["a3"]);
  });

  it("capability filter uses the real capability list", () => {
    expect(collectCapabilities(DATASET)).toEqual([
      "ledger",
      "summarize",
      "web_search",
    ]);
    expect(
      filterAgents(DATASET, { ...EMPTY_FILTERS, capability: "ledger" }).map(
        (a) => a.id,
      ),
    ).toEqual(["a2"]);
  });

  it("project filter matches current, allowed, and wildcard", () => {
    expect(collectProjects(DATASET)).toEqual(["money-mind"]);
    const inProject = filterAgents(DATASET, {
      ...EMPTY_FILTERS,
      project: "money-mind",
    });
    // a1 (allowed), a2 (current+allowed), a3 (wildcard)
    expect(inProject.map((a) => a.id).sort()).toEqual(["a1", "a2", "a3"]);
  });
});

describe("agentsView — sorting", () => {
  it("sorts by name ascending by default", () => {
    const sorted = sortAgents(DATASET, DEFAULT_SORT);
    expect(sorted.map((a) => a.name)).toEqual([
      "Finance Agent",
      "Ops Agent",
      "QA Agent",
      "Research Agent",
    ]);
  });

  it("sorts by tasks descending", () => {
    const sorted = sortAgents(DATASET, {
      column: "tasks",
      direction: "desc",
    });
    expect(sorted.map((a) => a.taskCount)).toEqual([10, 3, 0, 0]);
  });

  it("sorts undefined lastActivityAt last when ascending updated", () => {
    const sorted = sortAgents(DATASET, {
      column: "updated",
      direction: "desc",
    });
    expect(sorted[0]?.id).toBe("a2");
  });
});

describe("agentsView — summary", () => {
  it("derives counts only from the data", () => {
    const s = summarize(DATASET);
    expect(s.total).toBe(4);
    expect(s.available).toBe(1);
    expect(s.busy).toBe(1);
    expect(s.attention).toBe(1); // one failed, zero blocked
    expect(s.disabled).toBe(1); // a4: !enabled
  });
});

describe("agentsView — formatSuccessRate", () => {
  it("formats a fraction and handles null", () => {
    expect(formatSuccessRate(0.8)).toBe("80%");
    expect(formatSuccessRate(1)).toBe("100%");
    expect(formatSuccessRate(null)).toBe("—");
  });
});
