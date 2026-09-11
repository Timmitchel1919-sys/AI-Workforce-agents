import { describe, expect, it } from "vitest";
import type { ApprovalView } from "../../../api/contracts";
import {
  accessLevelLabel,
  agentPermissions,
  findPendingApprovalForTask,
  isGovernanceEvent,
} from "../governance";

function approval(over: Partial<ApprovalView> = {}): ApprovalView {
  return {
    approvalId: "ap-1",
    status: "requested",
    action: "resume_task",
    risk: "medium",
    requestedBy: "orchestrator:a1",
    reason: "approval policy requires a decision",
    requestedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("agentPermissions", () => {
  it("mirrors the real ROLE_CAPABILITIES for viewer / operator / admin", () => {
    const viewer = agentPermissions("viewer");
    expect(viewer.find((p) => p.capability === "view")?.granted).toBe(true);
    expect(viewer.find((p) => p.capability === "disable_agent")?.granted).toBe(
      false,
    );
    expect(viewer.find((p) => p.capability === "enable_agent")?.granted).toBe(
      false,
    );

    // disable_agent / enable_agent are admin-only on the real backend
    const operator = agentPermissions("operator");
    expect(
      operator.find((p) => p.capability === "disable_agent")?.granted,
    ).toBe(false);

    const admin = agentPermissions("admin");
    expect(admin.find((p) => p.capability === "disable_agent")?.granted).toBe(
      true,
    );
    expect(admin.find((p) => p.capability === "enable_agent")?.granted).toBe(
      true,
    );
  });

  it("an unauthenticated session gets nothing granted", () => {
    const perms = agentPermissions(null);
    expect(perms.every((p) => !p.granted)).toBe(true);
  });
});

describe("accessLevelLabel", () => {
  it("uses the real backend role value, not an invented classification", () => {
    expect(accessLevelLabel("viewer")).toBe("Viewer");
    expect(accessLevelLabel("operator")).toBe("Operator");
    expect(accessLevelLabel("admin")).toBe("Admin");
    expect(accessLevelLabel(null)).toBe("Unauthenticated");
  });
});

describe("findPendingApprovalForTask", () => {
  it("correlates a requested approval by taskId (the only real signal available)", () => {
    const approvals = [approval({ approvalId: "ap-1", taskId: "t-9" })];
    const found = findPendingApprovalForTask(approvals, "t-9");
    expect(found).toMatchObject({ approvalId: "ap-1", taskId: "t-9" });
  });

  it("returns null when there is no current task to correlate against", () => {
    const approvals = [approval({ taskId: "t-9" })];
    expect(findPendingApprovalForTask(approvals, undefined)).toBeNull();
  });

  it("returns null when no pending approval matches the current task", () => {
    const approvals = [approval({ taskId: "t-1" })];
    expect(findPendingApprovalForTask(approvals, "t-9")).toBeNull();
  });

  it("ignores an already-decided approval even if the taskId matches", () => {
    const approvals = [approval({ taskId: "t-9", status: "approved" })];
    expect(findPendingApprovalForTask(approvals, "t-9")).toBeNull();
  });
});

describe("isGovernanceEvent", () => {
  it("includes lifecycle commands, approval requests, and permission checks", () => {
    expect(isGovernanceEvent("control_command")).toBe(true);
    expect(isGovernanceEvent("approval_requested")).toBe(true);
    expect(isGovernanceEvent("permission_decision")).toBe(true);
  });

  it("excludes approval_decided — it is never recorded with an agentId, so a partial request-only view would mislead", () => {
    expect(isGovernanceEvent("approval_decided")).toBe(false);
  });

  it("excludes execution-shaped events (those belong to AgentExecutions, not governance)", () => {
    expect(isGovernanceEvent("agent_executed")).toBe(false);
    expect(isGovernanceEvent("task_completed")).toBe(false);
    expect(isGovernanceEvent("task_failed")).toBe(false);
  });
});
