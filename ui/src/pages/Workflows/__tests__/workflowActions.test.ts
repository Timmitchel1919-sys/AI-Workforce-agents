import { describe, expect, it } from "vitest";
import type { WorkflowView } from "../../../api/contracts";
import {
  availableWorkflowActions,
  structuralWorkflowActions,
  workflowActionConsequence,
} from "../workflowActions";

function workflow(overrides: Partial<WorkflowView> = {}): WorkflowView {
  return {
    workflowId: "workflow-1",
    name: "Money Mind review",
    description: "Review current state",
    projectId: "money-mind",
    status: "running",
    paused: false,
    progress: { completed: 0, total: 1, failed: 0, blocked: 0, fraction: 0 },
    pendingApprovals: 0,
    participatingAgents: ["research-agent"],
    stages: [],
    updatedAt: "2026-09-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("workflow action eligibility", () => {
  it("exposes only actual pause and cancel commands while running", () => {
    expect(structuralWorkflowActions(workflow())).toEqual(["pause", "cancel"]);
    expect(availableWorkflowActions(workflow(), "operator", "*")).toEqual([
      "pause",
      "cancel",
    ]);
  });

  it("uses resume rather than start when a workflow is paused or awaiting approval", () => {
    expect(structuralWorkflowActions(workflow({ paused: true }))).toEqual([
      "resume",
      "cancel",
    ]);
    expect(
      structuralWorkflowActions(workflow({ status: "awaiting_approval" })),
    ).toEqual(["resume", "cancel"]);
  });

  it("does not invent retry, rerun, or start controls for terminal workflows", () => {
    expect(structuralWorkflowActions(workflow({ status: "failed" }))).toEqual(
      [],
    );
  });

  it("keeps frontend capability and project checks advisory", () => {
    expect(availableWorkflowActions(workflow(), "viewer", "*")).toEqual([]);
    expect(availableWorkflowActions(workflow(), "operator", ["aims"])).toEqual(
      [],
    );
  });

  it("uses safe cancellation language without promising instant termination", () => {
    expect(workflowActionConsequence("cancel", workflow())).toMatch(
      /may require time to reach a safe terminal state/i,
    );
  });
});
