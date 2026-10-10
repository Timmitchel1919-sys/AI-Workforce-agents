/**
 * ExecutionOrchestrator (Layer 4).
 *
 *   PromptRequestView ──► plan (decomposer + dependency engine) ──► run
 *   run + advance ──► route agent ──► authorize tools ──► route model
 *       ──► cost preflight ──► approval gate ──► lock ──► runtime
 *       ──► claimed result ──► verification ──► gates ──► next tasks
 *
 * The orchestrator coordinates; it performs no specialist work. Every
 * collaborator is a narrow port. State is advanced only by explicit commands
 * (`start`, `advance`, `cancel`, …) — there is no hidden background loop — and
 * the run status is DERIVED from its tasks, never stored separately.
 *
 * Safety invariants (tested):
 *  - a task never runs before its dependencies COMPLETED;
 *  - an agent that "claims" success is not trusted: the result is verified;
 *  - gates (test / review / security) cannot be skipped, and a correction
 *    re-runs every gate that guarded the code that changed;
 *  - destructive and protected tasks run only after a human approval;
 *  - SECURITY failures block and are never retried automatically;
 *  - retries and corrections are bounded.
 */
import { randomBytes } from "node:crypto";
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  operatorCan,
  operatorCanAccessProject,
  type Agent,
  type OperatorPrincipal,
  type Repository,
} from "../../contracts/index.js";
import {
  DEFAULT_ORCHESTRATION_POLICY,
  canTransitionOrchTask,
  type ExecutionRun,
  type FailureClass,
  type OrchTask,
  type OrchTaskStatus,
  type OrchestrationPolicy,
  type OrchestrationRequest,
  type RecoveryAction,
  type RunStatus,
  type RunSummary,
  type RunView,
  type TaskResult,
} from "../../contracts/execution-orchestration.js";
import {
  UNRESOLVED_PROJECT,
  type PromptRequestView,
} from "../../contracts/prompt-intelligence.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import { createEvent, type EventPublisher } from "../events/event-bus.js";
import { containsSecret } from "../prompt-intelligence/secret-scan.js";
import { AgentRouter } from "./agent-router.js";
import { decompose } from "./decomposer.js";
import {
  dependentCount,
  parallelBatch,
  readyCandidates,
  upstreamOf,
  validatePlan,
} from "./dependency-engine.js";
import {
  authorizeTools,
  classifyFailure,
  decideRecovery,
  modelNeedFor,
  queueScore,
} from "./policies.js";
import {
  EvidenceVerifier,
  UnavailableTaskRuntime,
  type CostGate,
  type ModelRouterPort,
  type RuntimeOutcome,
  type TaskExecutionContext,
  type TaskRuntimePort,
  type VerifierPort,
} from "./ports.js";
import { ResourceLockManager } from "./resource-locks.js";

export interface OrchestratorDeps {
  runs: Repository<ExecutionRun>;
  projects: { has(projectId: string): boolean };
  agents: { list(): Agent[] };
  isAgentEnabled?: (agentId: string) => boolean;
  approvals: Pick<ApprovalSystem, "request" | "get">;
  audit: AuditLog;
  runtime?: TaskRuntimePort;
  verifier?: VerifierPort;
  models?: ModelRouterPort;
  cost?: CostGate;
  events?: EventPublisher;
  router?: AgentRouter;
  locks?: ResourceLockManager;
  policy?: Partial<OrchestrationPolicy>;
  clock?: () => string;
  newId?: () => string;
}

const ACCEPTED_VALIDATION = new Set(["PASS", "WARN", "APPROVAL_REQUIRED"]);
const TERMINAL: ReadonlySet<OrchTaskStatus> = new Set([
  "COMPLETED",
  "CANCELLED",
]);
const MAX_TASKS = 60;

function scrub(text: string, max = 400): string {
  if (containsSecret(text)) return "[redacted]";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export class ExecutionOrchestrator {
  private readonly runtime: TaskRuntimePort;
  private readonly verifier: VerifierPort;
  private readonly router: AgentRouter;
  private readonly locks: ResourceLockManager;
  private readonly policy: OrchestrationPolicy;
  private readonly clock: () => string;
  private readonly newId: () => string;
  private readonly mutex = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: OrchestratorDeps) {
    this.runtime = deps.runtime ?? new UnavailableTaskRuntime();
    this.verifier = deps.verifier ?? new EvidenceVerifier();
    this.router = deps.router ?? new AgentRouter();
    this.locks = deps.locks ?? new ResourceLockManager();
    this.policy = { ...DEFAULT_ORCHESTRATION_POLICY, ...(deps.policy ?? {}) };
    this.clock = deps.clock ?? (() => new Date().toISOString());
    this.newId = deps.newId ?? (() => `run-${randomBytes(6).toString("hex")}`);
  }

  /* -------------------------------------------------------------- */
  /* authorization                                                  */
  /* -------------------------------------------------------------- */

  private requireOrchestrator(principal: OperatorPrincipal): void {
    if (!operatorCan(principal, "orchestrate_execution")) {
      throw new PermissionDeniedError(
        `role "${principal.role}" may not orchestrate execution`,
      );
    }
  }

  private mustSee(principal: OperatorPrincipal, runId: unknown): ExecutionRun {
    if (typeof runId !== "string" || runId === "")
      throw new ValidationError("runId is required");
    const run = this.deps.runs.findById(runId);
    // A foreign run is indistinguishable from a missing one.
    if (!run || !operatorCanAccessProject(principal, run.projectId)) {
      throw new NotFoundError("execution run not found");
    }
    return run;
  }

  /* -------------------------------------------------------------- */
  /* planning                                                       */
  /* -------------------------------------------------------------- */

  /** Create a plan (and a run in NOT_STARTED) from a validated Layer 3 request. */
  createRun(principal: OperatorPrincipal, view: PromptRequestView): RunView {
    this.requireOrchestrator(principal);
    const { record, execution } = view;
    if (!ACCEPTED_VALIDATION.has(execution.validation)) {
      throw new StateTransitionError(
        `the request cannot be planned: validation is ${execution.validation}`,
      );
    }
    if (
      record.projectId === UNRESOLVED_PROJECT ||
      !this.deps.projects.has(record.projectId) ||
      !operatorCanAccessProject(principal, record.projectId)
    ) {
      throw new NotFoundError("project not found");
    }
    const existing = this.deps.runs
      .list()
      .find(
        (r) =>
          r.requestId === record.requestId &&
          r.request.promptVersion === execution.promptVersion &&
          !r.cancelled,
      );
    if (existing) return this.view(existing); // idempotent: never a second plan

    const now = this.clock();
    const runId = this.newId();
    const acceptance = record.prompt.sections.acceptanceCriteria;
    const { tasks, notes } = decompose({
      runId,
      projectId: record.projectId,
      now,
      maxAttempts: this.policy.maxRetries,
      intent: record.intent,
      context: record.context,
      promptText: record.prompt.text,
      acceptanceCriteria: acceptance,
    });
    if (tasks.length === 0 || tasks.length > MAX_TASKS) {
      throw new ValidationError("the plan has no tasks or too many tasks");
    }
    validatePlan(tasks);

    const request: OrchestrationRequest = {
      requestId: record.requestId,
      promptVersion: execution.promptVersion,
      projectId: record.projectId,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      objective: record.intent.objective,
      intent: record.intent.category,
      resolvedContextRef: `prompt_requests/${record.requestId}`,
      generatedPrompt: record.prompt.text,
      constraints: [
        ...record.intent.explicitConstraints,
        ...record.intent.impliedConstraints,
      ],
      acceptanceCriteria: [...acceptance],
      requiredCapabilities: record.intent.requiredCapabilities.map(
        (c) => c.capability,
      ),
      riskLevel: record.intent.risk,
      approvalRequirements: record.validation.approvalRequired
        ? [...record.validation.reasons]
        : [],
      relevantFiles: [...record.context.relevantFiles],
      dependencies: record.taskId ? [record.taskId] : [],
      requestedOutputs: [record.intent.expectedOutput],
      executionPolicy: { ...this.policy },
    };
    const run: ExecutionRun = {
      id: runId,
      runId,
      requestId: record.requestId,
      promptVersion: execution.promptVersion,
      request,
      projectId: record.projectId,
      objective: record.intent.objective,
      intent: record.intent.category,
      riskLevel: record.intent.risk,
      priority: record.intent.risk === "high" ? "high" : "normal",
      createdBy: principal.id,
      createdAt: now,
      updatedAt: now,
      started: false,
      paused: false,
      cancelled: false,
      policy: { ...this.policy },
      constraints: request.constraints,
      acceptanceCriteria: request.acceptanceCriteria,
      relevantFiles: request.relevantFiles,
      tasks,
      planNotes: notes,
      revision: 1,
    };
    this.deps.runs.upsert(run);
    this.emit("EXECUTION_CREATED", run, undefined, {
      requestId: run.requestId,
      intent: run.intent,
      actor: principal.id,
    });
    this.emit("PLAN_CREATED", run, undefined, { tasks: tasks.length, notes });
    for (const task of tasks) {
      this.emit("TASK_CREATED", run, task, {
        type: task.type,
        dependencies: task.dependencies,
      });
      this.publish(
        createEvent("TASK_CREATED", {
          taskId: task.taskId,
          projectId: run.projectId,
        }),
      );
    }
    return this.view(run);
  }

  /* -------------------------------------------------------------- */
  /* commands                                                       */
  /* -------------------------------------------------------------- */

  start(principal: OperatorPrincipal, runId: unknown): RunView {
    this.requireOrchestrator(principal);
    const run = this.mustSee(principal, runId);
    if (run.cancelled) throw new StateTransitionError("the run was cancelled");
    if (run.started) return this.view(run);
    run.started = true;
    // Destructive work asks for its human decision up front: the user sees
    // WAITING_APPROVAL immediately, whatever the rest of the plan is doing.
    for (const task of run.tasks) {
      if (task.destructive && task.requiresApproval && !task.approval) {
        this.requestApproval(run, task, principal.id);
      }
    }
    this.emit("WORKFLOW_STARTED", run, undefined, { actor: principal.id });
    this.publish(
      createEvent("WORKFLOW_STARTED", {
        workflowId: run.runId,
        projectId: run.projectId,
      }),
    );
    this.save(run);
    return this.view(run);
  }

  pause(principal: OperatorPrincipal, runId: unknown): RunView {
    this.requireOrchestrator(principal);
    const run = this.mustSee(principal, runId);
    if (run.cancelled) throw new StateTransitionError("the run was cancelled");
    run.paused = true;
    this.emit("WORKFLOW_PAUSED", run, undefined, { actor: principal.id });
    this.save(run);
    return this.view(run);
  }

  resume(principal: OperatorPrincipal, runId: unknown): RunView {
    this.requireOrchestrator(principal);
    const run = this.mustSee(principal, runId);
    if (run.cancelled) throw new StateTransitionError("the run was cancelled");
    run.paused = false;
    this.emit("WORKFLOW_RESUMED", run, undefined, { actor: principal.id });
    this.save(run);
    return this.view(run);
  }

  /** Cancel stops all future work; completed work is never pretended undone. */
  async cancel(principal: OperatorPrincipal, runId: unknown): Promise<RunView> {
    this.requireOrchestrator(principal);
    const initial = this.mustSee(principal, runId);
    // Signal the runtime BEFORE waiting for the run lock, so a long-running
    // command is stopped now rather than after it finishes.
    if (!initial.cancelled) this.runtime.cancelRun?.(initial.runId);
    return this.exclusive(initial.runId, () => {
      const run = this.mustSee(principal, runId);
      if (run.cancelled) return this.view(run);
      run.cancelled = true;
      for (const task of run.tasks) {
        if (!TERMINAL.has(task.status)) {
          this.locks.release(task.taskId);
          this.move(task, "CANCELLED");
          task.blockedReason = "run cancelled by the operator";
        }
      }
      this.emit("WORKFLOW_CANCELLED", run, undefined, { actor: principal.id });
      this.save(run);
      return this.view(run);
    });
  }

  /** Operator retry of a FAILED or BLOCKED task. SECURITY blocks cannot be retried here. */
  async retryTask(
    principal: OperatorPrincipal,
    runId: unknown,
    taskId: unknown,
  ): Promise<RunView> {
    this.requireOrchestrator(principal);
    const initial = this.mustSee(principal, runId);
    return this.exclusive(initial.runId, () => {
      const run = this.mustSee(principal, runId);
      const task = run.tasks.find((t) => t.taskId === taskId);
      if (!task) throw new NotFoundError("task not found");
      if (run.cancelled)
        throw new StateTransitionError("the run was cancelled");
      if (
        task.blockKind === "security" ||
        task.failures.some((f) => f.classification === "SECURITY")
      ) {
        throw new StateTransitionError(
          "a security failure is never retried automatically; change the plan or the request",
        );
      }
      if (task.status === "FAILED") {
        this.move(task, "RETRYING");
        task.attempts = 0;
        this.move(task, "READY");
      } else if (task.status === "BLOCKED") {
        this.move(task, "READY");
      } else {
        throw new StateTransitionError(
          `task is ${task.status}; only FAILED or BLOCKED tasks can be retried`,
        );
      }
      delete task.blockedReason;
      delete task.blockKind;
      this.emit("TASK_RETRIED", run, task, {
        actor: principal.id,
        manual: true,
      });
      this.save(run);
      return this.view(run);
    });
  }

  /**
   * Advance the run: repeatedly run whatever is ready, up to `maxSteps`
   * rounds, stopping as soon as nothing can progress (blocked, waiting for
   * approval, finished). Safe to call repeatedly; concurrent calls serialize.
   */
  async advance(
    principal: OperatorPrincipal,
    runId: unknown,
    maxSteps = 25,
  ): Promise<RunView> {
    this.requireOrchestrator(principal);
    const initial = this.mustSee(principal, runId);
    return this.exclusive(initial.runId, async () => {
      const run = this.mustSee(principal, runId);
      if (run.cancelled)
        throw new StateTransitionError("the run was cancelled");
      if (!run.started)
        throw new StateTransitionError("the run has not been started");
      if (run.paused) return this.view(run);
      const before = this.derive(run);
      for (let step = 0; step < Math.min(Math.max(maxSteps, 1), 100); step++) {
        const progressed = await this.step(run, principal);
        this.save(run);
        if (!progressed) break;
      }
      const after = this.derive(run);
      if (after === "COMPLETED" && before !== "COMPLETED") {
        this.emit("WORKFLOW_COMPLETED", run, undefined, {
          tasks: run.tasks.length,
        });
      }
      return this.view(run);
    });
  }

  /* -------------------------------------------------------------- */
  /* reads                                                          */
  /* -------------------------------------------------------------- */

  list(
    principal: OperatorPrincipal,
    filter: { projectId?: string; limit?: number } = {},
  ): RunSummary[] {
    if (!operatorCan(principal, "view"))
      throw new PermissionDeniedError("insufficient capabilities");
    return this.deps.runs
      .list()
      .filter((r) => operatorCanAccessProject(principal, r.projectId))
      .filter((r) =>
        filter.projectId ? r.projectId === filter.projectId : true,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(Math.max(filter.limit ?? 50, 1), 200))
      .map((run) => ({
        runId: run.runId,
        requestId: run.requestId,
        projectId: run.projectId,
        objective: run.objective,
        intent: run.intent,
        status: this.derive(run),
        progress: this.progress(run),
        createdBy: run.createdBy,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }));
  }

  async get(principal: OperatorPrincipal, runId: string): Promise<RunView> {
    if (!operatorCan(principal, "view"))
      throw new PermissionDeniedError("insufficient capabilities");
    const run = this.mustSee(principal, runId);
    const view = this.view(run);
    if (this.deps.cost?.spent) {
      let total = 0;
      let any = false;
      for (const task of run.tasks) {
        try {
          const spent = await this.deps.cost.spent(run.projectId, task.taskId);
          if (spent !== undefined) {
            total += spent;
            any = true;
          }
        } catch {
          /* cost visibility is best-effort and never fails a read */
        }
      }
      if (any)
        view.cost = {
          ...view.cost,
          spentUsd: total,
          note: "actual spend as priced by the AI Cost Center ledger",
        };
    }
    return view;
  }

  /** Task counts across the runs the principal may see (for the runtime overview). */
  stats(principal: OperatorPrincipal): {
    queued: number;
    waitingApproval: number;
    failedTasks: number;
    completedToday: number;
  } {
    if (!operatorCan(principal, "view"))
      throw new PermissionDeniedError("insufficient capabilities");
    const today = this.clock().slice(0, 10);
    const stats = {
      queued: 0,
      waitingApproval: 0,
      failedTasks: 0,
      completedToday: 0,
    };
    for (const run of this.deps.runs.list()) {
      if (!operatorCanAccessProject(principal, run.projectId)) continue;
      for (const task of run.tasks) {
        if (task.status === "READY" || task.status === "QUEUED")
          stats.queued += 1;
        else if (task.status === "WAITING_APPROVAL") stats.waitingApproval += 1;
        else if (task.status === "FAILED") stats.failedTasks += 1;
        else if (
          task.status === "COMPLETED" &&
          (task.completedAt ?? "").startsWith(today)
        )
          stats.completedToday += 1;
      }
    }
    return stats;
  }

  /** Aggregate status derived from the tasks (never stored separately). */
  derive(run: ExecutionRun): RunStatus {
    if (run.cancelled) return "CANCELLED";
    if (!run.started) return "NOT_STARTED";
    const s = run.tasks.map((t) => t.status);
    if (s.every((x) => x === "COMPLETED")) return "COMPLETED";
    if (s.some((x) => x === "FAILED")) return "FAILED";
    if (
      s.some(
        (x) =>
          x === "RUNNING" ||
          x === "QUEUED" ||
          x === "READY" ||
          x === "RETRYING",
      )
    )
      return "EXECUTING";
    if (s.some((x) => x === "WAITING_APPROVAL")) return "WAITING_APPROVAL";
    if (s.some((x) => x === "BLOCKED")) return "BLOCKED";
    if (s.some((x) => x === "REVIEW")) return "REVIEW";
    return s.some((x) => x === "PENDING") ? "EXECUTING" : "CANCELLED";
  }

  progress(run: ExecutionRun) {
    const total = run.tasks.length;
    const completed = run.tasks.filter((t) => t.status === "COMPLETED").length;
    return {
      total,
      completed,
      percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    };
  }

  private view(run: ExecutionRun): RunView {
    const tokens = run.tasks.reduce(
      (n, t) => n + (t.estimate?.inputTokens ?? 0),
      0,
    );
    return {
      run: structuredClone(run),
      status: this.derive(run),
      progress: this.progress(run),
      activeTaskIds: run.tasks
        .filter((t) => t.status === "RUNNING" || t.status === "QUEUED")
        .map((t) => t.taskId),
      cost: {
        estimatedInputTokens: tokens,
        note: "token estimate only; a dollar figure appears when the AI Cost Center ledger has priced actual usage",
      },
    };
  }

  /* -------------------------------------------------------------- */
  /* the advance step                                               */
  /* -------------------------------------------------------------- */

  private async step(
    run: ExecutionRun,
    principal: OperatorPrincipal,
  ): Promise<boolean> {
    let progressed = false;
    progressed = this.syncApprovals(run) || progressed;
    progressed = this.cascadeCancellations(run) || progressed;
    progressed = this.reevaluateBlocked(run) || progressed;
    for (const task of readyCandidates(run.tasks)) {
      this.move(task, "READY");
      progressed = true;
    }
    const nowMs = Date.parse(this.clock());
    const ready = run.tasks
      .filter(
        (t) =>
          (t.status === "READY" || t.status === "QUEUED") &&
          (!t.notBefore || Date.parse(t.notBefore) <= nowMs),
      )
      .sort(
        (a, b) =>
          queueScore(
            b,
            dependentCount(run.tasks, b.taskId),
            run.tasks.indexOf(b),
          ) -
          queueScore(
            a,
            dependentCount(run.tasks, a.taskId),
            run.tasks.indexOf(a),
          ),
      );
    const batch = parallelBatch(ready, this.policy.maxParallel);

    const toRun: { task: OrchTask; context: TaskExecutionContext }[] = [];
    for (const task of batch) {
      const prepared = await this.prepare(run, task, principal.id);
      if (prepared === "changed") progressed = true;
      else if (prepared) toRun.push({ task, context: prepared });
    }
    if (toRun.length > 0) {
      progressed = true;
      await Promise.all(
        toRun.map(({ task, context }) => this.execute(run, task, context)),
      );
    }
    return progressed;
  }

  /** Route, authorize and gate one task. Returns its context when it may run. */
  private async prepare(
    run: ExecutionRun,
    task: OrchTask,
    actor: string,
  ): Promise<TaskExecutionContext | "changed" | undefined> {
    const approved = task.approval?.state === "approved";
    const agents = this.deps.agents.list();
    const independentOf = task.independentOf
      .map(
        (id) => run.tasks.find((t) => t.taskId === id)?.assignedAgent?.agentId,
      )
      .filter((id): id is string => id !== undefined);
    const routed = this.router.route({
      task,
      approved,
      agents,
      ...(this.deps.isAgentEnabled
        ? { isEnabled: this.deps.isAgentEnabled }
        : {}),
      workload: (agentId) => this.workload(agentId),
      exclude: independentOf,
    });
    if (!routed.selected) {
      this.block(run, task, "routing", routed.reason ?? "no qualified agent");
      this.emit("TASK_BLOCKED", run, task, {
        reason: task.blockedReason,
        rejected: routed.rejected,
      });
      return "changed";
    }
    task.assignedAgent = routed.selected;
    const agent = agents.find((a) => a.id === routed.selected!.agentId)!;
    this.emit("AGENT_SELECTED", run, task, {
      agentId: agent.id,
      evidence: routed.selected.reasons,
      rejected: routed.rejected.length,
    });

    const toolAccess =
      agent.metadata?.["toolAccess"] === "none"
        ? "none"
        : agent.metadata?.["readOnly"] === true
          ? "read_only"
          : "standard";
    const tools = authorizeTools(task, {
      approved,
      agentToolAccess: toolAccess,
    });
    task.permittedTools = tools.permitted;
    task.deniedTools = tools.denied;
    this.emit("TOOL_AUTHORIZED", run, task, {
      permitted: tools.permitted,
      denied: tools.denied,
      reasons: tools.reasons,
    });

    if (this.deps.models) {
      task.assignedModel = await this.deps.models
        .select({
          projectId: run.projectId,
          taskId: task.taskId,
          agent,
          need: modelNeedFor(task),
        })
        .catch(() => ({ reason: "the model router could not select a model" }));
    } else {
      task.assignedModel = { reason: "no model router is configured" };
    }
    this.emit("MODEL_SELECTED", run, task, {
      model: task.assignedModel.model,
      provider: task.assignedModel.provider,
      reason: task.assignedModel.reason,
    });

    if (this.deps.cost) {
      const gate = await this.deps.cost
        .preflight(run.projectId, task.taskId)
        .catch(() => ({
          allowed: true,
          status: "unknown",
          detail: "cost preflight unavailable",
        }));
      if (!gate.allowed) {
        this.block(run, task, "budget", `budget gate: ${gate.detail}`);
        this.emit("TASK_BLOCKED", run, task, { reason: task.blockedReason });
        return "changed";
      }
    }

    if (task.requiresApproval && !approved) {
      if (
        !task.approval ||
        task.approval.state === "rejected" ||
        task.approval.state === "expired"
      ) {
        this.requestApproval(run, task, actor);
      } else {
        this.move(task, "WAITING_APPROVAL");
      }
      return "changed";
    }

    const lock = this.locks.tryAcquire(
      task.resources,
      task.taskId,
      Date.parse(this.clock()),
      this.policy.lockTtlMs,
    );
    if (!lock.ok) {
      if (task.status !== "QUEUED") {
        this.move(task, "QUEUED");
        task.blockedReason = `waiting for resource ${lock.key} (held by ${lock.owner})`;
        return "changed";
      }
      return undefined;
    }
    delete task.blockedReason;
    this.move(task, "RUNNING");
    task.startedAt = this.clock();
    this.emit("TASK_STARTED", run, task, { agentId: agent.id });
    this.publish(
      createEvent("AGENT_STARTED", { agentId: agent.id, taskId: task.taskId }),
    );
    return this.contextFor(run, task, agent.id);
  }

  private async execute(
    run: ExecutionRun,
    task: OrchTask,
    context: TaskExecutionContext,
  ): Promise<void> {
    let outcome: RuntimeOutcome;
    try {
      outcome = await this.runtime.execute(structuredClone(task), context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "runtime error";
      outcome = {
        kind: "failure",
        error: message,
        classification: classifyFailure(message),
      };
    } finally {
      this.locks.release(task.taskId);
    }
    if (outcome.kind === "failure") {
      this.fail(
        run,
        task,
        outcome.classification ?? classifyFailure(outcome.error),
        outcome.error,
        outcome.tool,
      );
      return;
    }
    // CLAIMED success: held in REVIEW until verified.
    const claimed: TaskResult = {
      claimed: "success",
      summary: scrub(outcome.summary),
      evidence: outcome.evidence.map((e) => scrub(e, 300)).slice(0, 20),
      checks: (outcome.checks ?? []).slice(0, 30),
      ...(outcome.verdict ? { verdict: outcome.verdict } : {}),
      verified: false,
    };
    task.result = claimed;
    this.move(task, "REVIEW");
    const verification = this.verifier.verify(task, claimed);
    if (!verification.verified) {
      this.fail(
        run,
        task,
        "LOGICAL",
        `success was claimed but not verified: ${verification.detail}`,
      );
      return;
    }
    if (claimed.verdict === "changes_requested") {
      this.fail(run, task, "LOGICAL", `changes requested: ${claimed.summary}`);
      return;
    }
    claimed.verified = true;
    claimed.verifiedAt = this.clock();
    claimed.verification = verification.detail;
    this.move(task, "COMPLETED");
    task.completedAt = this.clock();
    this.emit("TASK_COMPLETED", run, task, {
      verified: true,
      detail: verification.detail,
    });
    this.publish(
      createEvent("AGENT_COMPLETED", {
        agentId: task.assignedAgent?.agentId ?? "unknown",
        taskId: task.taskId,
        result: "verified",
      }),
    );
  }

  /* -------------------------------------------------------------- */
  /* failure + recovery                                             */
  /* -------------------------------------------------------------- */

  private fail(
    run: ExecutionRun,
    task: OrchTask,
    classification: FailureClass,
    error: string,
    tool?: string,
  ): void {
    const alternative = this.router.route({
      task: {
        ...task,
        excludedAgents: [
          ...task.excludedAgents,
          ...(task.assignedAgent ? [task.assignedAgent.agentId] : []),
        ],
      },
      approved: task.approval?.state === "approved",
      agents: this.deps.agents.list(),
      ...(this.deps.isAgentEnabled
        ? { isEnabled: this.deps.isAgentEnabled }
        : {}),
    }).selected;
    const recovery: RecoveryAction = decideRecovery({
      classification,
      attempts: task.attempts,
      maxAttempts: task.maxAttempts,
      corrections: task.corrections,
      maxCorrections: this.policy.maxCorrections,
      isGate: task.gate !== undefined,
      hasCorrectionTarget: task.correctionTarget !== undefined,
      alternativeAgentAvailable: alternative !== undefined,
    });
    task.failures.push({
      at: this.clock(),
      taskId: task.taskId,
      ...(task.assignedAgent ? { agentId: task.assignedAgent.agentId } : {}),
      ...(task.assignedModel?.model ? { model: task.assignedModel.model } : {}),
      ...(tool ? { tool } : {}),
      error: scrub(error, 500),
      classification,
      retryCount: task.attempts,
      recovery,
    });
    this.emit("TASK_FAILED", run, task, {
      classification,
      recovery,
      error: scrub(error, 300),
    });

    switch (recovery) {
      case "RETRY": {
        task.attempts += 1;
        task.notBefore = new Date(
          Date.parse(this.clock()) + this.policy.retryBackoffMs * task.attempts,
        ).toISOString();
        this.move(task, "RETRYING");
        this.move(task, "READY");
        this.emit("TASK_RETRIED", run, task, {
          attempt: task.attempts,
          notBefore: task.notBefore,
        });
        break;
      }
      case "CORRECT": {
        if (task.gate && task.correctionTarget) this.correct(run, task, error);
        else {
          task.attempts += 1;
          task.prompt =
            `${task.prompt}\nPrevious attempt failed: ${scrub(error, 300)}`.slice(
              0,
              6000,
            );
          this.move(task, "RETRYING");
          this.move(task, "READY");
          this.emit("TASK_RETRIED", run, task, {
            attempt: task.attempts,
            correction: true,
          });
        }
        break;
      }
      case "REASSIGN": {
        if (task.assignedAgent)
          task.excludedAgents.push(task.assignedAgent.agentId);
        delete task.assignedAgent;
        task.attempts = 0;
        this.move(task, "RETRYING");
        this.move(task, "READY");
        this.emit("TASK_RETRIED", run, task, { reassigned: true });
        break;
      }
      case "BLOCK": {
        this.block(
          run,
          task,
          "security",
          `blocked by a security failure: ${scrub(error, 200)}`,
        );
        this.emit("TASK_BLOCKED", run, task, { reason: task.blockedReason });
        break;
      }
      case "WAIT": {
        this.block(run, task, "runtime", scrub(error, 200));
        this.emit("TASK_BLOCKED", run, task, { reason: task.blockedReason });
        break;
      }
      case "ESCALATE": {
        this.move(task, "FAILED");
        // A failed mandatory gate blocks whatever would ship the change.
        if (task.gate) {
          for (const other of run.tasks) {
            if (
              (other.type === "INTEGRATION" || other.type === "DEPLOYMENT") &&
              upstreamOf(run.tasks, other.taskId).has(task.taskId) &&
              other.status === "PENDING"
            ) {
              this.move(other, "BLOCKED");
              other.blockKind = "dependency";
              other.blockedReason = `blocked: the ${task.gate} gate "${task.title}" failed`;
            }
          }
        }
        break;
      }
    }
  }

  /**
   * LOGICAL gate failure: spawn a correction task for the implementer and
   * re-run every gate that guarded the code that is about to change (a
   * COMPLETED gate is cloned, never reopened — its verification is stale).
   */
  private correct(run: ExecutionRun, gate: OrchTask, error: string): void {
    const target = run.tasks.find((t) => t.taskId === gate.correctionTarget);
    if (!target) {
      this.move(gate, "FAILED");
      return;
    }
    const n = gate.corrections + 1;
    if (run.tasks.length + 6 > MAX_TASKS) {
      this.move(gate, "FAILED");
      return;
    }
    const fix: OrchTask = {
      ...structuredClone(target),
      taskId: `${gate.taskId}-fix${n}`,
      parentTaskId: target.taskId,
      title: `Correct: ${gate.title} findings`,
      description: `Address the failed ${gate.gate ?? "gate"}: ${scrub(error, 200)}`,
      dependencies: [target.taskId],
      status: "PENDING",
      attempts: 0,
      corrections: 0,
      failures: [],
      prompt:
        `${target.prompt}\nCorrection required (${gate.title}): ${scrub(error, 400)}`.slice(
          0,
          6000,
        ),
      acceptanceCriteria: [
        ...target.acceptanceCriteria,
        `Resolve: ${scrub(error, 160)}`,
      ],
      excludedAgents: [],
      independentOf: [],
      createdAt: this.clock(),
      updatedAt: this.clock(),
    };
    delete fix.result;
    delete fix.assignedAgent;
    delete fix.assignedModel;
    delete fix.startedAt;
    delete fix.completedAt;
    delete fix.blockedReason;
    delete fix.notBefore;
    run.tasks.push(fix);
    this.emit("TASK_CREATED", run, fix, { correctionFor: gate.taskId });

    const downstreamGates = run.tasks.filter(
      (t) =>
        t.gate !== undefined &&
        t.taskId !== fix.taskId &&
        upstreamOf(run.tasks, t.taskId).has(target.taskId),
    );
    const cloneOf = new Map<string, string>();
    for (const g of downstreamGates) {
      if (g.taskId === gate.taskId || !TERMINAL.has(g.status)) continue;
      if (g.status === "COMPLETED") {
        const clone: OrchTask = {
          ...structuredClone(g),
          taskId: `${g.taskId}-rerun${n}`,
          rerunOf: g.rerunOf ?? g.taskId,
          status: "PENDING",
          attempts: 0,
          corrections: 0,
          failures: [],
          // Only independent reviewers must also differ from the fixer.
          independentOf:
            g.independentOf.length > 0 ? [...g.independentOf, fix.taskId] : [],
          createdAt: this.clock(),
          updatedAt: this.clock(),
        };
        delete clone.result;
        delete clone.assignedAgent;
        delete clone.assignedModel;
        delete clone.startedAt;
        delete clone.completedAt;
        delete clone.approval;
        run.tasks.push(clone);
        cloneOf.set(g.taskId, clone.taskId);
        this.emit("TASK_CREATED", run, clone, { rerunOf: g.taskId });
      }
    }
    const remap = (deps: string[]): string[] => [
      ...new Set(deps.map((d) => cloneOf.get(d) ?? d)),
    ];
    for (const clone of cloneOf.values()) {
      const t = run.tasks.find((x) => x.taskId === clone)!;
      t.dependencies = [...new Set([...remap(t.dependencies), fix.taskId])];
    }
    // Every non-terminal task now waits for the fix and for the fresh gates.
    const cloneIds = new Set(cloneOf.values());
    for (const t of run.tasks) {
      if (
        t.taskId === fix.taskId ||
        cloneIds.has(t.taskId) ||
        TERMINAL.has(t.status)
      )
        continue;
      const guardsChangedCode =
        t.gate !== undefined &&
        upstreamOf(run.tasks, t.taskId).has(target.taskId);
      t.dependencies = remap(t.dependencies);
      if (guardsChangedCode)
        t.dependencies = [...new Set([...t.dependencies, fix.taskId])];
      if (t.taskId === gate.taskId) {
        t.corrections += 1;
        if (t.independentOf.length > 0)
          t.independentOf = [...new Set([...t.independentOf, fix.taskId])];
        this.move(t, "RETRYING");
        this.move(t, "PENDING");
        t.attempts = 0;
      } else if (t.status === "READY" || t.status === "QUEUED") {
        this.move(t, "PENDING");
      }
    }
    validatePlan(run.tasks);
  }

  /* -------------------------------------------------------------- */
  /* approvals                                                      */
  /* -------------------------------------------------------------- */

  private requestApproval(
    run: ExecutionRun,
    task: OrchTask,
    actor: string,
  ): void {
    const action = task.destructive
      ? "orchestration.execute_delete_operation"
      : task.type === "DEPLOYMENT"
        ? "orchestration.deploy_release"
        : task.type === "INTEGRATION"
          ? "orchestration.commit_source"
          : "orchestration.approve_task";
    const approval = this.deps.approvals.request({
      requestedBy: actor,
      action,
      reason: scrub(
        `Approval required before running "${task.title}" for ${run.objective} ` +
          `(risk ${task.risk}; responsible capability ${task.requiredCapabilities.join(", ")}; ` +
          `expected: ${task.acceptanceCriteria[0] ?? "see plan"}).`,
        500,
      ),
      metadata: {
        projectId: run.projectId,
        runId: run.runId,
        taskId: task.taskId,
        requestId: run.requestId,
        approvalKind: "orchestration_task",
        ...(task.assignedAgent ? { agentId: task.assignedAgent.agentId } : {}),
      },
    });
    task.approval = {
      approvalId: approval.id,
      state: "requested",
      requestedAt: this.clock(),
    };
    this.move(task, "WAITING_APPROVAL");
    this.emit("APPROVAL_REQUESTED", run, task, {
      approvalId: approval.id,
      action,
    });
    this.publish(
      createEvent("APPROVAL_REQUESTED", { approvalId: approval.id, action }),
    );
  }

  /** The approval state is read from the live ApprovalSystem, never trusted from the run. */
  private syncApprovals(run: ExecutionRun): boolean {
    let changed = false;
    for (const task of run.tasks) {
      if (task.status !== "WAITING_APPROVAL" || !task.approval) continue;
      const live = this.deps.approvals.get(task.approval.approvalId);
      if (!live || live.status === "requested") continue;
      if (live.status === "approved") {
        task.approval.state = "approved";
        this.move(task, "PENDING");
        this.emit("APPROVAL_GRANTED", run, task, {
          approvalId: live.id,
          decidedBy: live.decidedBy,
        });
      } else {
        task.approval.state = live.status;
        this.move(task, "CANCELLED");
        task.blockedReason = `approval ${live.status}`;
        this.emit("APPROVAL_DENIED", run, task, {
          approvalId: live.id,
          status: live.status,
        });
      }
      changed = true;
    }
    return changed;
  }

  private cascadeCancellations(run: ExecutionRun): boolean {
    let changed = false;
    for (const task of run.tasks) {
      if (TERMINAL.has(task.status) || task.status === "RUNNING") continue;
      const upstreamCancelled = task.dependencies.some(
        (d) => run.tasks.find((t) => t.taskId === d)?.status === "CANCELLED",
      );
      if (upstreamCancelled) {
        this.move(task, "CANCELLED");
        task.blockedReason = "an upstream task was cancelled";
        changed = true;
      }
    }
    return changed;
  }

  /** Routing/budget/runtime blocks are retried each advance; security blocks never are. */
  private reevaluateBlocked(run: ExecutionRun): boolean {
    let changed = false;
    for (const task of run.tasks) {
      if (task.status !== "BLOCKED") continue;
      if (task.blockKind === "security" || task.blockKind === "dependency")
        continue;
      const deps = task.dependencies.every(
        (d) => run.tasks.find((t) => t.taskId === d)?.status === "COMPLETED",
      );
      if (!deps) continue;
      this.move(task, "READY");
      delete task.blockedReason;
      delete task.blockKind;
      changed = true;
    }
    return changed;
  }

  /* -------------------------------------------------------------- */
  /* helpers                                                        */
  /* -------------------------------------------------------------- */

  private block(
    run: ExecutionRun,
    task: OrchTask,
    kind: NonNullable<OrchTask["blockKind"]>,
    reason: string,
  ): void {
    void run;
    if (task.status !== "BLOCKED") this.move(task, "BLOCKED");
    task.blockKind = kind;
    task.blockedReason = reason;
  }

  private move(task: OrchTask, to: OrchTaskStatus): void {
    if (task.status === to) return;
    if (!canTransitionOrchTask(task.status, to)) {
      throw new StateTransitionError(
        `task ${task.taskId}: illegal transition ${task.status} → ${to}`,
      );
    }
    task.status = to;
    task.updatedAt = this.clock();
  }

  private workload(agentId: string): number {
    let n = 0;
    for (const run of this.deps.runs.list()) {
      for (const t of run.tasks) {
        if (
          t.assignedAgent?.agentId === agentId &&
          (t.status === "RUNNING" || t.status === "QUEUED")
        )
          n += 1;
      }
    }
    return n;
  }

  /** Least context: this task's slice + direct upstream summaries. Never secrets. */
  private contextFor(
    run: ExecutionRun,
    task: OrchTask,
    agentId: string,
  ): TaskExecutionContext {
    const upstream = task.dependencies
      .map((id) => run.tasks.find((t) => t.taskId === id))
      .filter((t): t is OrchTask => t?.result?.verified === true)
      .map((t) => ({
        taskId: t.taskId,
        title: t.title,
        summary: scrub(t.result!.summary, 300),
      }));
    return {
      runId: run.runId,
      projectId: run.projectId,
      objective: run.objective,
      constraints: run.constraints,
      acceptanceCriteria: task.acceptanceCriteria,
      relevantFiles: run.relevantFiles,
      prompt: task.prompt,
      upstream,
      permittedTools: task.permittedTools,
      ...(task.assignedModel ? { model: task.assignedModel } : {}),
      agentId,
    };
  }

  private save(run: ExecutionRun): void {
    run.updatedAt = this.clock();
    run.revision += 1;
    this.deps.runs.upsert(structuredClone(run));
  }

  private emit(
    event: string,
    run: ExecutionRun,
    task: OrchTask | undefined,
    data: Record<string, unknown>,
  ): void {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      safe[key] = typeof value === "string" ? scrub(value, 500) : value;
    }
    this.deps.audit.record("workflow_event", {
      projectId: run.projectId,
      ...(task ? { taskId: task.taskId } : {}),
      ...(task?.assignedAgent ? { agentId: task.assignedAgent.agentId } : {}),
      data: { event, runId: run.runId, requestId: run.requestId, ...safe },
    });
  }

  private publish(event: ReturnType<typeof createEvent>): void {
    try {
      this.deps.events?.publish(event);
    } catch {
      /* an event consumer must never break orchestration */
    }
  }

  /** Serialize operations on one run (an in-process mutex). */
  private exclusive<T>(runId: string, work: () => T | Promise<T>): Promise<T> {
    const previous = this.mutex.get(runId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.mutex.set(
      runId,
      next.catch(() => undefined),
    );
    return next as Promise<T>;
  }
}
