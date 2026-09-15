import { describe, expect, it } from "vitest";
import type { TaskView } from "../../../api/contracts";
import { availableTaskActions, structuralTaskAction } from "../taskActions";

function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    taskId: "task-1",
    type: "research",
    description: "Inspect a source",
    projectId: "money-mind",
    status: "queued",
    priority: "normal",
    dependsOn: [],
    retryCount: 0,
    createdAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

describe("task action operation matrix", () => {
  it.each(["created", "queued", "running", "blocked", "awaiting_approval"])(
    "offers cancel for a %s task when the operator is authorized",
    (status) => {
      expect(availableTaskActions(task({ status }), "operator", "*")).toEqual([
        "cancel",
      ]);
    },
  );

  it("offers retry only for a failed standalone task", () => {
    expect(
      availableTaskActions(task({ status: "failed" }), "operator", "*"),
    ).toEqual(["retry"]);
    expect(
      availableTaskActions(
        task({ status: "failed", workflowId: "workflow-1" }),
        "operator",
        "*",
      ),
    ).toEqual([]);
  });

  it("does not invent controls for terminal or unsupported task states", () => {
    expect(structuralTaskAction(task({ status: "completed" }))).toBeNull();
    expect(structuralTaskAction(task({ status: "cancelled" }))).toBeNull();
    expect(
      structuralTaskAction(
        task({ status: "failed", workflowId: "workflow-1" }),
      ),
    ).toBeNull();
  });

  it("uses role and project scope only as an advisory UI restriction", () => {
    expect(availableTaskActions(task(), "viewer", "*")).toEqual([]);
    expect(availableTaskActions(task(), "operator", ["aims"])).toEqual([]);
  });
});
