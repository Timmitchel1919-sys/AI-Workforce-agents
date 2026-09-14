import { describe, expect, it } from "vitest";
import type { TaskView } from "../../../api/contracts";
import { priorityTone, sortTasksByUpdated, summarizeTasks } from "../tasksView";

function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    taskId: "task-1",
    type: "research",
    description: "Inspect the project",
    projectId: "money-mind",
    status: "queued",
    priority: "normal",
    dependsOn: [],
    retryCount: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("tasksView", () => {
  it("sorts the newest updated task first without mutating the input", () => {
    const input = [
      task({ taskId: "old" }),
      task({ taskId: "new", updatedAt: "2026-09-02T10:00:00.000Z" }),
    ];
    expect(sortTasksByUpdated(input).map((item) => item.taskId)).toEqual([
      "new",
      "old",
    ]);
    expect(input[0]?.taskId).toBe("old");
  });

  it("derives queue metrics and preserves the server total", () => {
    const summary = summarizeTasks(
      [
        task({ status: "running" }),
        task({ taskId: "2", status: "awaiting_approval" }),
        task({ taskId: "3", status: "blocked" }),
        task({ taskId: "4", status: "completed" }),
      ],
      12,
    );
    expect(summary).toEqual({
      total: 12,
      running: 1,
      queued: 0,
      awaitingApproval: 1,
      attention: 1,
      completed: 1,
    });
  });

  it("maps priority labels to conservative badge tones", () => {
    expect(priorityTone("urgent")).toBe("danger");
    expect(priorityTone("high")).toBe("warning");
    expect(priorityTone("normal")).toBe("info");
    expect(priorityTone("low")).toBe("neutral");
  });
});
