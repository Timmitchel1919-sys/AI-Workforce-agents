import { describe, expect, it } from "vitest";
import type { AuditEventView } from "../../../api/contracts";
import {
  EMPTY_EXECUTION_FILTERS,
  executionFiltersActive,
  filterExecutions,
  pairExecutions,
  summarizeExecutions,
  type AgentExecutionView,
} from "../executions";

function ev(over: Partial<AuditEventView>): AuditEventView {
  return {
    id: "e0",
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "task_completed",
    data: {},
    ...over,
  };
}

describe("pairExecutions", () => {
  it("pairs agent_executed with the matching task_completed and computes a real duration", () => {
    const events = [
      ev({
        id: "start-1",
        type: "agent_executed",
        taskId: "t-1",
        agentId: "a1",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      ev({
        id: "end-1",
        type: "task_completed",
        taskId: "t-1",
        agentId: "a1",
        timestamp: "2026-01-01T00:00:42.000Z",
      }),
    ];
    const [exec] = pairExecutions(events, undefined);
    expect(exec).toMatchObject({
      id: "start-1",
      taskId: "t-1",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:42.000Z",
      durationMs: 42_000,
    });
  });

  it("pairs agent_executed with task_failed and surfaces the (already-redacted) error", () => {
    const events = [
      ev({
        id: "start-1",
        type: "agent_executed",
        taskId: "t-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      ev({
        id: "end-1",
        type: "task_failed",
        taskId: "t-1",
        timestamp: "2026-01-01T00:00:05.000Z",
        data: { error: "tool_unavailable" },
      }),
    ];
    const [exec] = pairExecutions(events, undefined);
    expect(exec.status).toBe("failed");
    expect(exec.error).toBe("tool_unavailable");
    expect(exec.durationMs).toBe(5000);
  });

  it("matches retries independently by position, not just by taskId", () => {
    const events = [
      ev({
        id: "start-1",
        type: "agent_executed",
        taskId: "t-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      ev({
        id: "fail-1",
        type: "task_failed",
        taskId: "t-1",
        timestamp: "2026-01-01T00:00:01.000Z",
        data: { error: "timeout" },
      }),
      ev({
        id: "start-2",
        type: "agent_executed",
        taskId: "t-1",
        timestamp: "2026-01-01T00:01:00.000Z",
      }),
      ev({
        id: "done-2",
        type: "task_completed",
        taskId: "t-1",
        timestamp: "2026-01-01T00:01:10.000Z",
      }),
    ];
    const results = pairExecutions(events, undefined);
    expect(results).toHaveLength(2);
    const [latest, earlier] = results; // newest first
    expect(latest).toMatchObject({
      id: "start-2",
      status: "completed",
      durationMs: 10_000,
    });
    expect(earlier).toMatchObject({
      id: "start-1",
      status: "failed",
      error: "timeout",
    });
  });

  it("marks an unmatched start as running only when it is the agent's current task", () => {
    const events = [
      ev({
        id: "start-1",
        type: "agent_executed",
        taskId: "t-9",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const running = pairExecutions(events, "t-9");
    expect(running[0]?.status).toBe("running");
    expect(running[0]?.completedAt).toBeUndefined();

    const unknown = pairExecutions(events, "some-other-task");
    expect(unknown[0]?.status).toBe("unknown");
  });

  it("a terminal event with no matching start still appears, without a fabricated duration", () => {
    const events = [
      ev({
        id: "end-1",
        type: "task_failed",
        taskId: "t-5",
        timestamp: "2026-01-01T00:00:00.000Z",
        data: { error: "approval_rejected" },
      }),
    ];
    const [exec] = pairExecutions(events, undefined);
    expect(exec.status).toBe("failed");
    expect(exec.startedAt).toBeUndefined();
    expect(exec.durationMs).toBeNull();
  });

  it("ignores unrelated audit event types (e.g. model_execution_started)", () => {
    const events = [
      ev({ id: "x1", type: "model_execution_started", taskId: "t-1" }),
      ev({ id: "x2", type: "tool_execution", taskId: "t-1" }),
    ];
    expect(pairExecutions(events, undefined)).toEqual([]);
  });
});

describe("summarizeExecutions", () => {
  it("derives counts and an average duration only from loaded executions", () => {
    const summary = summarizeExecutions([
      { id: "1", status: "running", durationMs: null },
      { id: "2", status: "completed", durationMs: 1000 },
      { id: "3", status: "completed", durationMs: 3000 },
      { id: "4", status: "failed", durationMs: null },
    ] satisfies AgentExecutionView[]);
    expect(summary).toEqual({
      active: 1,
      completed: 2,
      failed: 1,
      averageDurationMs: 2000,
    });
  });

  it("averageDurationMs is null when nothing has a real duration", () => {
    const summary = summarizeExecutions([
      { id: "1", status: "running", durationMs: null },
    ] satisfies AgentExecutionView[]);
    expect(summary.averageDurationMs).toBeNull();
  });
});

describe("execution filters", () => {
  const items = [
    {
      id: "abc123",
      taskId: "t-1",
      status: "completed",
      durationMs: 1000,
    },
    {
      id: "def456",
      taskId: "t-2",
      status: "failed",
      durationMs: null,
      error: "timeout",
    },
  ] satisfies AgentExecutionView[];

  it("no filters returns everything", () => {
    expect(executionFiltersActive(EMPTY_EXECUTION_FILTERS)).toBe(false);
    expect(filterExecutions(items, EMPTY_EXECUTION_FILTERS)).toHaveLength(2);
  });

  it("status filter is exact", () => {
    expect(
      filterExecutions(items, { search: "", status: "failed" }).map(
        (e) => e.id,
      ),
    ).toEqual(["def456"]);
  });

  it("search matches execution id, task id, and error text", () => {
    expect(
      filterExecutions(items, { search: "t-1", status: "all" }),
    ).toHaveLength(1);
    expect(
      filterExecutions(items, { search: "timeout", status: "all" }),
    ).toHaveLength(1);
  });
});
