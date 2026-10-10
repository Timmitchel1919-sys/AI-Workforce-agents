import type { ExecutionRun, OrchTask, PreparedRequestSummary, RunStatus, RunSummary, RunView } from "../types";

const NOW = "2026-05-01T10:00:00.000Z";

export function makeTask(overrides: Partial<OrchTask> = {}): OrchTask {
  return {
    taskId: "t1",
    runId: "run-1",
    projectId: "money-mind",
    title: "Implement login card",
    description: "Make the login card shorter",
    type: "DEVELOPMENT",
    requiredCapabilities: ["frontend_development"],
    dependencies: [],
    priority: "normal",
    risk: "low",
    status: "PENDING",
    permittedTools: ["read_file"],
    deniedTools: ["delete_file"],
    acceptanceCriteria: ["Card is shorter"],
    prompt: "do it",
    destructive: false,
    requiresApproval: false,
    resources: [],
    excludedAgents: [],
    independentOf: [],
    attempts: 0,
    maxAttempts: 3,
    corrections: 0,
    failures: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeRun(tasks: OrchTask[], overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: "run-1",
    runId: "run-1",
    requestId: "req-1",
    promptVersion: 1,
    projectId: "money-mind",
    objective: "Shorten the login card",
    intent: "UI_MODIFICATION",
    riskLevel: "low",
    priority: "normal",
    createdBy: "u1",
    createdAt: NOW,
    updatedAt: NOW,
    started: false,
    paused: false,
    cancelled: false,
    constraints: [],
    acceptanceCriteria: [],
    relevantFiles: [],
    tasks,
    planNotes: ["Security review omitted: no security-relevant change."],
    revision: 1,
    ...overrides,
  };
}

export function makeView(options: {
  status?: RunStatus;
  tasks?: OrchTask[];
  run?: Partial<ExecutionRun>;
  completed?: number;
  total?: number;
  percent?: number;
  activeTaskIds?: string[];
  cost?: RunView["cost"];
} = {}): RunView {
  const tasks = options.tasks ?? [makeTask()];
  return {
    run: makeRun(tasks, options.run),
    status: options.status ?? "NOT_STARTED",
    progress: {
      total: options.total ?? tasks.length,
      completed: options.completed ?? 0,
      percent: options.percent ?? 0,
    },
    activeTaskIds: options.activeTaskIds ?? [],
    cost: options.cost ?? { estimatedInputTokens: 1200, note: "tokens only" },
  };
}

export function summaryOf(view: RunView, overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: view.run.runId,
    requestId: view.run.requestId,
    projectId: view.run.projectId,
    objective: view.run.objective,
    intent: view.run.intent,
    status: view.status,
    progress: view.progress,
    createdBy: view.run.createdBy,
    createdAt: view.run.createdAt,
    updatedAt: view.run.updatedAt,
    ...overrides,
  };
}

export function preparedRequest(overrides: Partial<PreparedRequestSummary> = {}): PreparedRequestSummary {
  return {
    requestId: "req-1",
    projectId: "money-mind",
    createdAt: NOW,
    validation: "PASS",
    request: "Make the login card shorter",
    ...overrides,
  };
}
