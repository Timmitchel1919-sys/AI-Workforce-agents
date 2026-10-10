import { describe, expect, it } from "vitest";
import { parseTasksPayload } from "../tasksClient";

describe("parseTasksPayload", () => {
  it("maps the real Control Plane page ({ items, total } of TaskView) onto the task board", () => {
    const snapshot = parseTasksPayload({
      items: [
        { taskId: "t1", type: "build", description: "Build web", projectId: "alpha", status: "running", priority: "high", assignedAgentId: "web-agent", dependsOn: [], retryCount: 0, createdAt: "2026-09-24T10:00:00.000Z", updatedAt: "2026-09-24T10:01:00.000Z" },
        { taskId: "t2", type: "review", description: "Review", projectId: "alpha", status: "awaiting_approval", priority: "normal", dependsOn: [], retryCount: 0, createdAt: "2026-09-24T09:00:00.000Z", updatedAt: "2026-09-24T09:00:00.000Z" },
        { taskId: "t3", type: "test", description: "Tests", projectId: "alpha", status: "created", priority: "low", dependsOn: [], retryCount: 0, createdAt: "2026-09-24T08:00:00.000Z", updatedAt: "2026-09-24T08:00:00.000Z" },
      ],
      total: 7,
      nextCursor: "abc",
    });
    expect(snapshot.tasks.map((t) => [t.id, t.status, t.agentId])).toEqual([
      ["t1", "running", "web-agent"],
      ["t2", "blocked", undefined],
      ["t3", "pending", undefined],
    ]);
    expect(snapshot.tasks[0]!.title).toBe("Build web");
    expect(snapshot.summary).toEqual({ total: 7, running: 1, completed: 0, failed: 0, pending: 1 });
  });

  it("never crashes on empty or unexpected payloads", () => {
    for (const payload of [undefined, null, {}, { items: null }, { data: 1 }, "oops", [{ nope: true }]]) {
      const snapshot = parseTasksPayload(payload);
      expect(snapshot.tasks).toEqual([]);
      expect(snapshot.summary.total).toBe(0);
    }
  });

  it("still accepts the UI snapshot shape", () => {
    const snapshot = parseTasksPayload({
      tasks: [{ id: "a", title: "A", status: "completed", createdAt: "2026-09-24T00:00:00.000Z" }],
      summary: { total: 1, running: 0, completed: 1, failed: 0, pending: 0 },
    });
    expect(snapshot.tasks[0]!.title).toBe("A");
    expect(snapshot.summary.completed).toBe(1);
  });
});
