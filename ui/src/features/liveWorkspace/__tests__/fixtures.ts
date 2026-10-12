import type { RuntimeEvent, RuntimeSession, RuntimeSessionSummary } from "../types";

const NOW = "2026-05-01T10:00:00.000Z";

export function makeEvent(seq: number, type: RuntimeEvent["type"], data: Record<string, unknown> = {}): RuntimeEvent {
  return { seq, executionId: "ex-1", type, at: NOW, data };
}

export function makeSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id: "ex-1",
    executionId: "ex-1",
    projectId: "money-mind",
    runId: "run-9",
    taskId: "task-login",
    agentId: "frontend-agent",
    modelId: "model-x",
    workspaceId: "ws-1",
    status: "RUNNING",
    createdAt: NOW,
    updatedAt: NOW,
    startedAt: NOW,
    currentOperation: "npm run build",
    paused: false,
    heartbeatAt: NOW,
    commands: [],
    changes: [],
    validation: [],
    tools: [],
    retries: 1,
    estimatedInputTokens: 1234,
    events: [],
    nextSeq: 1,
    revision: 1,
    ...overrides,
  };
}

export function summaryOf(s: RuntimeSession, extra: Partial<RuntimeSessionSummary> = {}): RuntimeSessionSummary {
  return {
    executionId: s.executionId,
    projectId: s.projectId,
    ...(s.runId ? { runId: s.runId } : {}),
    taskId: s.taskId,
    agentId: s.agentId,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    changedFiles: s.changes.length,
    flagged: s.scope?.status === "FLAGGED_FOR_REVIEW",
    ...extra,
  };
}
