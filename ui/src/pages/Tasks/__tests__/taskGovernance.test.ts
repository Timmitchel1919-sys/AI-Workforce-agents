import { describe, expect, it } from "vitest";
import type {
  ApprovalView,
  AuditEventView,
  TaskView,
} from "../../../api/contracts";
import {
  TASK_AUDIT_SUMMARY_LIMIT,
  findTaskApproval,
  hasTaskProjectAccess,
  taskGovernanceEvents,
  taskPermissions,
} from "../taskGovernance";

const task: TaskView = {
  taskId: "task-1",
  type: "research",
  description: "Inspect a source",
  projectId: "money-mind",
  status: "awaiting_approval",
  priority: "normal",
  dependsOn: [],
  retryCount: 0,
  approvalId: "approval-2",
  approvalState: "requested",
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
};

function approval(overrides: Partial<ApprovalView> = {}): ApprovalView {
  return {
    approvalId: "approval-1",
    status: "requested",
    action: "write",
    risk: "medium",
    requestedBy: "project-manager-agent",
    reason: "Review required",
    taskId: task.taskId,
    projectId: task.projectId,
    requestedAt: "2026-09-14T10:01:00.000Z",
    ...overrides,
  };
}

function event(overrides: Partial<AuditEventView>): AuditEventView {
  return {
    id: "event-1",
    type: "control_command",
    timestamp: "2026-09-14T10:01:00.000Z",
    taskId: task.taskId,
    data: {},
    ...overrides,
  };
}

describe("task governance model", () => {
  it("represents only actual Control Plane task capabilities", () => {
    const viewer = taskPermissions("viewer");
    const operator = taskPermissions("operator");
    expect(viewer.map((permission) => permission.granted)).toEqual([
      true,
      false,
      false,
    ]);
    expect(operator.map((permission) => permission.granted)).toEqual([
      true,
      true,
      true,
    ]);
    expect(hasTaskProjectAccess(["money-mind"], task)).toBe(true);
    expect(hasTaskProjectAccess(["aims"], task)).toBe(false);
  });

  it("prefers the task's approval id over an older task-correlated record", () => {
    const older = approval({ approvalId: "approval-1" });
    const current = approval({
      approvalId: "approval-2",
      requestedAt: "2026-09-14T10:02:00.000Z",
    });
    expect(findTaskApproval([older, current], task)?.approvalId).toBe(
      "approval-2",
    );
  });

  it("uses the newest real task-correlated approval when no approval id is exposed", () => {
    const older = approval({ requestedAt: "2026-09-14T10:01:00.000Z" });
    const latest = approval({
      approvalId: "approval-3",
      requestedAt: "2026-09-14T10:03:00.000Z",
    });
    expect(
      findTaskApproval([older, latest], { ...task, approvalId: undefined })
        ?.approvalId,
    ).toBe("approval-3");
  });

  it("keeps the audit summary task-scoped, relevant, newest-first, and bounded", () => {
    const events = Array.from(
      { length: TASK_AUDIT_SUMMARY_LIMIT + 2 },
      (_, index) =>
        event({
          id: `event-${index}`,
          type: index === 0 ? "agent_executed" : "control_command",
          timestamp: `2026-09-14T10:${String(index).padStart(2, "0")}:00.000Z`,
        }),
    );
    events.push(
      event({
        id: "other-task",
        taskId: "task-2",
        timestamp: "2026-09-14T11:00:00.000Z",
      }),
    );

    const summary = taskGovernanceEvents(events, task.taskId);
    expect(summary).toHaveLength(TASK_AUDIT_SUMMARY_LIMIT);
    expect(summary.every((entry) => entry.taskId === task.taskId)).toBe(true);
    expect(summary.every((entry) => entry.type !== "agent_executed")).toBe(
      true,
    );
    expect(summary[0]?.id).toBe(`event-${TASK_AUDIT_SUMMARY_LIMIT + 1}`);
  });
});
