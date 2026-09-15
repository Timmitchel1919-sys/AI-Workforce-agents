import { describe, expect, it } from "vitest";
import type { WorkflowView } from "../../../api/contracts";
import {
  collectWorkflowProjects,
  collectWorkflowStatuses,
  EMPTY_WORKFLOW_FILTERS,
  filterWorkflows,
  filtersActive,
  sortWorkflowsByUpdated,
  summarizeWorkflows,
} from "../workflowsView";

const workflows: WorkflowView[] = [
  {
    workflowId: "workflow-1",
    name: "Money Mind review",
    description: "Review the current financial model",
    projectId: "money-mind",
    status: "running",
    paused: false,
    progress: {
      completed: 1,
      total: 3,
      failed: 0,
      blocked: 0,
      fraction: 1 / 3,
    },
    pendingApprovals: 0,
    participatingAgents: ["research-agent", "qa-agent"],
    stages: [],
    updatedAt: "2026-09-14T10:00:00.000Z",
  },
  {
    workflowId: "workflow-2",
    name: "AIMS release review",
    description: "Validate release readiness",
    projectId: "aims",
    status: "failed",
    paused: false,
    progress: {
      completed: 2,
      total: 3,
      failed: 1,
      blocked: 0,
      fraction: 2 / 3,
    },
    pendingApprovals: 1,
    participatingAgents: ["developer-agent"],
    stages: [],
    updatedAt: "2026-09-14T11:00:00.000Z",
  },
  {
    workflowId: "workflow-3",
    name: "Money Mind completed run",
    description: "Completed analysis",
    projectId: "money-mind",
    status: "completed",
    paused: false,
    progress: { completed: 1, total: 1, failed: 0, blocked: 0, fraction: 1 },
    pendingApprovals: 0,
    participatingAgents: [],
    stages: [],
    updatedAt: "2026-09-14T09:00:00.000Z",
  },
];

describe("workflow registry view model", () => {
  it("filters by actual metadata fields", () => {
    expect(
      filterWorkflows(workflows, {
        ...EMPTY_WORKFLOW_FILTERS,
        search: "financial",
      }).map((workflow) => workflow.workflowId),
    ).toEqual(["workflow-1"]);
    expect(
      filterWorkflows(workflows, {
        ...EMPTY_WORKFLOW_FILTERS,
        status: "completed",
        projectId: "money-mind",
      }).map((workflow) => workflow.workflowId),
    ).toEqual(["workflow-3"]);
  });

  it("derives available filter options and registry summaries", () => {
    expect(collectWorkflowStatuses(workflows)).toEqual([
      "completed",
      "failed",
      "running",
    ]);
    expect(collectWorkflowProjects(workflows)).toEqual(["aims", "money-mind"]);
    expect(summarizeWorkflows(workflows)).toEqual({
      total: 3,
      running: 1,
      awaitingApproval: 0,
      failed: 1,
      completed: 1,
    });
  });

  it("sorts newest first without mutating the source", () => {
    expect(
      sortWorkflowsByUpdated(workflows).map((workflow) => workflow.workflowId),
    ).toEqual(["workflow-2", "workflow-1", "workflow-3"]);
    expect(workflows[0]?.workflowId).toBe("workflow-1");
  });

  it("identifies active filters", () => {
    expect(filtersActive(EMPTY_WORKFLOW_FILTERS)).toBe(false);
    expect(
      filtersActive({ ...EMPTY_WORKFLOW_FILTERS, projectId: "aims" }),
    ).toBe(true);
  });
});
