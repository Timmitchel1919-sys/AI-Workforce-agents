import { describe, expect, it } from "vitest";
import type { AuditEventView, TaskView } from "../../../api/contracts";
import { buildTaskTimeline } from "../taskTimeline";

const task: TaskView = {
  taskId: "task-1",
  type: "research",
  description: "Inspect architecture",
  projectId: "money-mind",
  status: "completed",
  priority: "high",
  assignedAgentId: "research-agent",
  dependsOn: [],
  retryCount: 0,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:10:00.000Z",
};

function event(overrides: Partial<AuditEventView>): AuditEventView {
  return {
    id: "event-1",
    timestamp: "2026-09-01T10:05:00.000Z",
    type: "agent_executed",
    taskId: "task-1",
    data: {},
    ...overrides,
  };
}

describe("buildTaskTimeline", () => {
  it("orders task events chronologically and maps lifecycle labels", () => {
    const result = buildTaskTimeline(task, [
      event({
        id: "done",
        type: "task_completed",
        timestamp: "2026-09-01T10:10:00.000Z",
      }),
      event({
        id: "assigned",
        type: "task_assigned",
        agentId: "research-agent",
      }),
    ]);
    expect(result.map((item) => item.title)).toEqual([
      "Task created",
      "Agent assigned",
      "Task completed",
    ]);
    expect(result[1]?.detail).toBe("Assigned to research-agent");
  });

  it("ignores events belonging to another task", () => {
    const result = buildTaskTimeline(task, [
      event({ id: "other", taskId: "task-2", type: "task_failed" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Task created");
  });

  it("does not duplicate a real creation event", () => {
    const result = buildTaskTimeline(task, [
      event({ id: "created", type: "task_created", timestamp: task.createdAt }),
    ]);
    expect(result).toHaveLength(1);
  });
});
