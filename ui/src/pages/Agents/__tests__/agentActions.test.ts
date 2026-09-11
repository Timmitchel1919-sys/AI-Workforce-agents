import { describe, expect, it } from "vitest";
import type { AgentView } from "../../../api/contracts";
import { toAgentListItem } from "../agentsView";
import {
  agentActionConsequence,
  agentActionDialogTitle,
  agentActionLabel,
  availableAgentActions,
} from "../agentActions";

function agent(over: Partial<AgentView> = {}) {
  return toAgentListItem({
    agentId: "a1",
    name: "Research Agent",
    role: "research",
    capabilities: [],
    status: "available",
    enabled: true,
    allowedProjects: ["*"],
    stats: {
      taskCount: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      successRate: null,
    },
    ...over,
  });
}

describe("agentActions — operation matrix (only what the Control Plane exposes)", () => {
  it("an enabled agent offers only 'disable' to an admin", () => {
    expect(availableAgentActions(agent({ enabled: true }), "admin")).toEqual([
      "disable",
    ]);
  });

  it("a disabled agent offers only 'enable' to an admin", () => {
    expect(availableAgentActions(agent({ enabled: false }), "admin")).toEqual([
      "enable",
    ]);
  });

  it("an operator role (no disable_agent/enable_agent capability) gets no actions", () => {
    expect(availableAgentActions(agent({ enabled: true }), "operator")).toEqual(
      [],
    );
    expect(
      availableAgentActions(agent({ enabled: false }), "operator"),
    ).toEqual([]);
  });

  it("never offers activate / pause / resume / restart / configure / delete", () => {
    const actions = [
      ...availableAgentActions(agent({ enabled: true }), "admin"),
      ...availableAgentActions(agent({ enabled: false }), "admin"),
    ];
    for (const a of actions) {
      expect(["disable", "enable"]).toContain(a);
    }
  });

  it("a viewer (no control-plane command capability) gets no actions", () => {
    expect(availableAgentActions(agent({ enabled: true }), "viewer")).toEqual(
      [],
    );
    expect(availableAgentActions(agent({ enabled: false }), "viewer")).toEqual(
      [],
    );
  });

  it("an unauthenticated session (no role) gets no actions", () => {
    expect(availableAgentActions(agent({ enabled: true }), null)).toEqual([]);
  });
});

describe("agentActions — copy uses real lifecycle semantics", () => {
  it("labels and dialog titles reference the actual agent", () => {
    const a = agent({ name: "Finance Agent" });
    expect(agentActionLabel("disable")).toBe("Disable agent");
    expect(agentActionLabel("enable")).toBe("Enable agent");
    expect(agentActionDialogTitle("disable", a)).toBe("Disable Finance Agent?");
  });

  it("the disable consequence copy is accurate: reversible, running tasks unaffected", () => {
    const text = agentActionConsequence("disable", agent());
    expect(text).toMatch(/stop being assigned new work/i);
    expect(text).toMatch(/running tasks are unaffected/i);
    expect(text).toMatch(/re-enable it later/i);
  });

  it("the enable consequence copy is accurate", () => {
    const text = agentActionConsequence("enable", agent());
    expect(text).toMatch(/eligible for task assignment again/i);
  });
});
