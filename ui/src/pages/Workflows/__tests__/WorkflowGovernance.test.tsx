import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  AuditEventView,
  TaskView,
  WorkflowView,
} from "../../../api/contracts";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { WorkflowApprovalSummary } from "../components/WorkflowApprovalSummary";
import {
  WorkflowGovernanceCard,
  workflowPermissionHints,
} from "../components/WorkflowGovernanceCard";
import { WorkflowProvenanceCard } from "../components/WorkflowProvenanceCard";

function workflow(overrides: Partial<WorkflowView> = {}): WorkflowView {
  return {
    workflowId: "workflow-1",
    name: "Money Mind review",
    description: "Review current state",
    projectId: "money-mind",
    status: "running",
    paused: false,
    progress: { completed: 0, total: 1, failed: 0, blocked: 0, fraction: 0 },
    pendingApprovals: 1,
    participatingAgents: ["research-agent"],
    stages: [],
    updatedAt: "2026-09-15T10:00:00.000Z",
    ...overrides,
  };
}

const task: TaskView = {
  taskId: "task-1",
  workflowId: "workflow-1",
  type: "research",
  description: "Inspect sources",
  projectId: "money-mind",
  status: "awaiting_approval",
  priority: "normal",
  dependsOn: [],
  retryCount: 0,
  approvalId: "approval-1",
  approvalState: "requested",
  createdAt: "2026-09-15T10:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
};

const event: AuditEventView = {
  id: "audit-1",
  timestamp: "2026-09-15T10:01:00.000Z",
  type: "approval_requested",
  actor: "operator-1",
  workflowId: "workflow-1",
  taskId: "task-1",
  agentId: "research-agent",
  correlationId: "corr-1",
  data: {},
};

describe("workflow governance", () => {
  it("shows permission hints as advisory rather than an authorization decision", () => {
    expect(workflowPermissionHints(workflow(), "operator", "*")).toEqual([
      { action: "pause", label: "Pause workflow", state: "can_request" },
      { action: "resume", label: "Resume workflow", state: "can_request" },
      { action: "cancel", label: "Cancel workflow", state: "can_request" },
    ]);
    expect(workflowPermissionHints(workflow(), "viewer", "*")[0]?.state).toBe(
      "read_only",
    );
  });

  it("renders sourced approval references without fetching the global approval list", () => {
    renderWithProviders(
      <WorkflowApprovalSummary workflow={workflow()} tasks={[task]} />,
    );
    expect(screen.getByText("Pending approvals")).toBeInTheDocument();
    expect(screen.getByText("Approval approval-1")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Approvals" }),
    ).toHaveAttribute("href", "/approvals");
  });

  it("renders only bounded, linked provenance and explicitly marks unavailable data", () => {
    renderWithProviders(
      <WorkflowProvenanceCard
        workflow={workflow()}
        tasks={[task]}
        events={[event]}
      />,
    );
    expect(screen.getByText("Definition version")).toBeInTheDocument();
    expect(
      screen.getAllByText("Not exposed by the Control Plane").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "research-agent" }),
    ).toHaveAttribute("href", "/agents/research-agent");
    expect(screen.getByRole("link", { name: "task-1" })).toHaveAttribute(
      "href",
      "/tasks/task-1",
    );
  });

  it("keeps governance observational for a read-only operator", () => {
    renderWithProviders(
      <WorkflowGovernanceCard
        workflow={workflow()}
        role="viewer"
        allowedProjects="*"
      />,
    );
    expect(
      screen.getByText("Operational permission hints"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Read-only").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/not an authorization decision/i),
    ).toBeInTheDocument();
  });
});
