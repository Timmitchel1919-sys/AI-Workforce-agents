/** Shared fixtures for the Layer 9–13 tests. Real services; only the data sources are plain arrays. */
import {
  ApprovalSystem,
  AuditLog,
  SecuritySystem,
  inMemorySecurityRepos,
  type ExecutionRun,
  type OperatorPrincipal,
  type OrchTask,
  type UsageRecord,
} from "../../core/index.js";

export const ADMIN: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: "*",
};
export const OPERATOR: OperatorPrincipal = {
  id: "op-1",
  role: "operator",
  allowedProjects: "*",
};
export const VIEWER: OperatorPrincipal = {
  id: "v-1",
  role: "viewer",
  allowedProjects: "*",
};
export const ALPHA_ONLY: OperatorPrincipal = {
  id: "op-a",
  role: "operator",
  allowedProjects: ["alpha"],
};

export function makeClock(start = "2026-10-11T12:00:00.000Z") {
  let t = Date.parse(start);
  return {
    now: () => t,
    iso: () => new Date(t).toISOString(),
    advance: (ms: number) => (t += ms),
    set: (iso: string) => (t = Date.parse(iso)),
  };
}

export function makeSecurity(clock = makeClock()) {
  const audit = new AuditLog();
  const approvals = new ApprovalSystem();
  const security = new SecuritySystem({
    repos: inMemorySecurityRepos(),
    audit,
    approvals,
    agents: {
      get: (id) => ({ id, allowedProjects: ["alpha", "beta", "gamma"] }),
      list: () => [],
    },
    clock: clock.iso,
  });
  return { audit, approvals, security, clock };
}

let n = 0;
const uid = (p: string) => `${p}-${++n}`;

export function task(
  o: Partial<OrchTask> & { projectId?: string; agent?: string } = {},
): OrchTask {
  const { agent, ...rest } = o;
  const base = {
    taskId: uid("task"),
    runId: "run-x",
    projectId: "alpha",
    title: "Task",
    description: "",
    type: "DEVELOPMENT",
    requiredCapabilities: [],
    dependencies: [],
    priority: "normal",
    risk: "low",
    status: "COMPLETED",
    permittedTools: [],
    deniedTools: [],
    acceptanceCriteria: [],
    prompt: "",
    destructive: false,
    requiresApproval: false,
    resources: [],
    excludedAgents: [],
    independentOf: [],
    attempts: 1,
    maxAttempts: 3,
    corrections: 0,
    failures: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    startedAt: "2026-10-01T00:00:00.000Z",
    completedAt: "2026-10-01T00:10:00.000Z",
    ...(agent
      ? {
          assignedAgent: {
            agentId: agent,
            agentName: agent,
            coveredCapabilities: [],
            reasons: [],
            workload: 0,
          },
        }
      : {}),
    ...rest,
  };
  return base as unknown as OrchTask;
}

export function run(
  projectId: string,
  tasks: OrchTask[],
  o: Partial<ExecutionRun> = {},
): ExecutionRun {
  const runId = uid("run");
  return {
    id: runId,
    runId,
    requestId: uid("req"),
    promptVersion: 1,
    projectId,
    objective: "Do the work",
    intent: "FEATURE",
    riskLevel: "low",
    priority: "normal",
    createdBy: "owner",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T01:00:00.000Z",
    started: true,
    paused: false,
    cancelled: false,
    constraints: [],
    acceptanceCriteria: [],
    relevantFiles: [],
    planNotes: [],
    revision: 1,
    tasks: tasks.map((t) => ({ ...t, runId, projectId })),
    ...o,
  } as unknown as ExecutionRun;
}

/** Same derivation as the orchestrator (kept in sync by the integration test in layer 11). */
export function derive(r: ExecutionRun) {
  if (r.cancelled) return "CANCELLED" as const;
  if (!r.started) return "NOT_STARTED" as const;
  const s = r.tasks.map((t) => t.status);
  if (s.every((x) => x === "COMPLETED")) return "COMPLETED" as const;
  if (s.some((x) => x === "FAILED")) return "FAILED" as const;
  if (s.some((x) => ["RUNNING", "QUEUED", "READY", "RETRYING"].includes(x)))
    return "EXECUTING" as const;
  if (s.some((x) => x === "WAITING_APPROVAL"))
    return "WAITING_APPROVAL" as const;
  if (s.some((x) => x === "BLOCKED")) return "BLOCKED" as const;
  return "EXECUTING" as const;
}

export function usage(
  o: Partial<UsageRecord> & { usd?: number | null } = {},
): UsageRecord {
  const { usd, ...rest } = o;
  const priced = usd !== null && usd !== undefined;
  return {
    usageId: uid("use"),
    projectId: "alpha",
    provider: "anthropic",
    model: "claude-sonnet-5",
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    cost: priced
      ? { priced: true, amountUsd: usd, pricingVersion: "t" }
      : { priced: false, reason: "no price" },
    createdAt: "2026-10-05T00:00:00.000Z",
    ...rest,
  } as UsageRecord;
}
