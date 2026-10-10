/**
 * GovernedTaskRuntime (Layer 5) — implements the Layer 4 `TaskRuntimePort`.
 *
 *   Layer 4 task ─► session (CREATED → INITIALIZING → READY → RUNNING …)
 *     ─► explicit workspace resolution ─► project-isolation check
 *     ─► tool session (authorized tools only) ─► the work
 *     ─► structured result (+ evidence) back to Layer 4, which VERIFIES it.
 *
 * What the runtime does itself, deterministically: inspect, validate
 * (typecheck → lint → test → build), diff + scope checks, governed commit,
 * deployment hand-off. What needs judgement or code generation — authoring,
 * semantic review, security review — is delegated to an `AgentExecutorPort`
 * through the tool session; with none configured those tasks report an
 * honest "no agent executor" instead of pretending.
 */
import { type OrchTask } from "../../contracts/execution-orchestration.js";
import type { FailureClass } from "../../contracts/execution-orchestration.js";
import {
  type FileChange,
  type RuntimeErrorKind,
  type RuntimeSession,
  type ScopeReport,
  type ValidationStageResult,
} from "../../contracts/execution-runtime.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
import type {
  RuntimeOutcome,
  TaskExecutionContext,
  TaskRuntimePort,
} from "../execution-orchestration/ports.js";
import { evaluateScope, netChanges } from "./diff-and-scope.js";
import { GitError, LocalGitOps, type GitOps } from "./git-ops.js";
import { PathRefusedError } from "./path-guard.js";
import { LocalProcessRunner, type ProcessRunner } from "./process-runner.js";
import { CapacityError, type SessionManager } from "./session-manager.js";
import {
  AgentToolSession,
  CommandRefusedError,
  CommandTimeoutError,
  ExecutionCancelledError,
  ExecutionPausedError,
  ToolDeniedError,
  commitPolicy,
  extractErrors,
  runValidation,
} from "./tools.js";
import {
  ApprovalRequiredError,
  FileConflictError,
  WorkspaceResolver,
  WorkspaceUnavailableError,
  type ResolvedWorkspace,
} from "./workspace.js";

/* ------------------------------------------------------------------ */
/* Ports                                                              */
/* ------------------------------------------------------------------ */

/** What an agent executor (the LLM loop) is given for one task. */
export interface AgentWork {
  task: OrchTask;
  context: TaskExecutionContext;
  tools: AgentToolSession;
  /** Mechanical facts the runtime computed (diff scope, validation so far). */
  facts: {
    scope: ScopeReport;
    changes: readonly FileChange[];
    validation: readonly ValidationStageResult[];
  };
}

export interface AgentExecutorPort {
  perform(work: AgentWork): Promise<RuntimeOutcome>;
}

/** Deployment is a hand-off to the deployment pipeline, never a shell command. */
export interface DeploymentHandoffPort {
  readonly available: boolean;
  handoff(input: {
    projectId: string;
    runId: string;
    taskId: string;
    branch?: string;
    commit?: string;
  }): Promise<{ reference: string }>;
}

export class UnavailableDeploymentHandoff implements DeploymentHandoffPort {
  readonly available = false;
  async handoff(): Promise<never> {
    throw new WorkspaceUnavailableError(
      "the deployment pipeline is not configured in this runtime",
    );
  }
}

export interface RuntimeDeps {
  resolver: Pick<WorkspaceResolver, "resolve">;
  manager: SessionManager;
  runner?: ProcessRunner;
  gitFactory?: (workspace: ResolvedWorkspace) => GitOps;
  agentExecutor?: AgentExecutorPort;
  deployment?: DeploymentHandoffPort;
  clock?: () => string;
  identity?: { name: string; email: string };
  /** Cap on a single command, in milliseconds. */
  maxCommandMs?: number;
}

/* ------------------------------------------------------------------ */
/* Error mapping                                                      */
/* ------------------------------------------------------------------ */

interface Mapped {
  kind: RuntimeErrorKind;
  /** Layer 4 failure class (drives retry / correct / block / wait). */
  failure: FailureClass;
  message: string;
}

function mapError(error: unknown): Mapped {
  const message = maskSecrets(
    error instanceof Error ? error.message : "runtime error",
  ).slice(0, 800);
  if (error instanceof ExecutionCancelledError)
    return { kind: "AGENT_ERROR", failure: "APPROVAL", message };
  if (error instanceof ExecutionPausedError)
    return { kind: "AGENT_ERROR", failure: "APPROVAL", message };
  if (error instanceof PathRefusedError)
    return { kind: "SECURITY_ERROR", failure: "SECURITY", message };
  if (error instanceof CommandRefusedError) {
    return error.commandClass === "BLOCKED"
      ? { kind: "SECURITY_ERROR", failure: "SECURITY", message }
      : { kind: "AUTHORIZATION_ERROR", failure: "APPROVAL", message };
  }
  if (
    error instanceof ToolDeniedError ||
    error instanceof ApprovalRequiredError
  ) {
    return { kind: "AUTHORIZATION_ERROR", failure: "APPROVAL", message };
  }
  if (error instanceof WorkspaceUnavailableError)
    return { kind: "ENVIRONMENT_ERROR", failure: "APPROVAL", message };
  if (error instanceof CommandTimeoutError)
    return { kind: "TIMEOUT", failure: "TRANSIENT", message };
  if (error instanceof CapacityError)
    return { kind: "ENVIRONMENT_ERROR", failure: "TRANSIENT", message };
  if (error instanceof FileConflictError)
    return { kind: "CODE_ERROR", failure: "LOGICAL", message };
  if (error instanceof GitError)
    return { kind: "COMMAND_ERROR", failure: "LOGICAL", message };
  if (error instanceof StageFailed)
    return { kind: error.kind, failure: "LOGICAL", message };
  return { kind: "TOOL_ERROR", failure: "LOGICAL", message };
}

class StageFailed extends Error {
  constructor(
    readonly kind: "TEST_FAILURE" | "BUILD_FAILURE" | "CODE_ERROR",
    message: string,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* Runtime                                                            */
/* ------------------------------------------------------------------ */

export class GovernedTaskRuntime implements TaskRuntimePort {
  readonly id = "governed-local";
  private readonly clock: () => string;
  private readonly runner: ProcessRunner;
  private readonly identity: { name: string; email: string };

  constructor(private readonly deps: RuntimeDeps) {
    this.clock = deps.clock ?? (() => new Date().toISOString());
    this.runner = deps.runner ?? new LocalProcessRunner();
    this.identity = deps.identity ?? {
      name: "AI Workforce",
      email: "ai-workforce@localhost",
    };
  }

  /** Layer 4 cancels a run: stop its live processes now, not after they finish. */
  cancelRun(runId: string): void {
    this.deps.manager.cancelRun(runId);
  }

  async execute(
    task: OrchTask,
    context: TaskExecutionContext,
  ): Promise<RuntimeOutcome> {
    const { manager } = this.deps;
    // A paused execution of THIS task is resumed, not duplicated.
    const existing = manager
      .list({ runId: context.runId, taskId: task.taskId })
      .find((s) => s.status === "PAUSED");
    let session: RuntimeSession;
    try {
      if (existing) {
        session = manager.live(existing.executionId)!;
        if (session.paused)
          return this.failure(
            "AGENT_ERROR",
            "APPROVAL",
            "the execution is paused",
          );
        manager.transition(session, "RUNNING");
      } else {
        session = manager.create({
          projectId: task.projectId,
          runId: context.runId,
          workflowId: context.runId,
          taskId: task.taskId,
          agentId: context.agentId,
          ...(context.model?.model ? { modelId: context.model.model } : {}),
          ...(task.estimate
            ? { estimatedInputTokens: task.estimate.inputTokens }
            : {}),
          retries: task.attempts,
        });
        manager.transition(session, "INITIALIZING");
      }
    } catch (error) {
      const mapped = mapError(error);
      return this.failure(mapped.kind, mapped.failure, mapped.message);
    }

    try {
      const workspace = await this.deps.resolver.resolve(task.projectId);
      // Project isolation: the workspace must belong to the task's project AND the run's project.
      if (
        workspace.binding.projectId !== task.projectId ||
        context.projectId !== task.projectId
      ) {
        throw new PathRefusedError(
          "outside_workspace",
          "the workspace does not belong to this task's project",
        );
      }
      session.workspaceId = workspace.descriptor.workspaceId;
      if (session.status === "INITIALIZING")
        manager.transition(session, "READY");
      manager.transition(session, "RUNNING", { operation: task.title });

      const tools = new AgentToolSession({
        session,
        manager,
        workspace,
        permittedTools: context.permittedTools,
        approved: task.approval?.state === "approved",
        runner: this.runner,
        git:
          this.deps.gitFactory?.(workspace) ??
          new LocalGitOps(workspace.rootReal),
        clock: this.clock,
        ...(this.deps.maxCommandMs
          ? { maxCommandMs: this.deps.maxCommandMs }
          : {}),
      });
      const outcome = await this.perform(
        task,
        context,
        session,
        workspace,
        tools,
      );
      return this.finish(session, outcome);
    } catch (error) {
      return this.fail(session, error);
    }
  }

  /* -------------------------------------------------------------- */

  private async perform(
    task: OrchTask,
    context: TaskExecutionContext,
    session: RuntimeSession,
    workspace: ResolvedWorkspace,
    tools: AgentToolSession,
  ): Promise<RuntimeOutcome> {
    const { manager } = this.deps;
    const runChanges = (): FileChange[] =>
      manager
        .list({ runId: context.runId })
        .flatMap((s) => s.changes)
        .concat([]);
    const scopeOf = (changes: readonly FileChange[]): ScopeReport =>
      evaluateScope(changes, {
        relevantFiles: context.relevantFiles,
        keywords: keywordsOf(context),
      });
    const authoring = task.resources.length > 0;

    switch (task.type) {
      case "ANALYSIS":
      case "RESEARCH":
      case "DESIGN": {
        if (this.deps.agentExecutor)
          return this.delegate(
            task,
            context,
            session,
            tools,
            scopeOf,
            runChanges,
          );
        if (!/^Inspect\b/.test(task.title)) {
          return this.failure(
            "ENVIRONMENT_ERROR",
            "APPROVAL",
            "this analysis needs an agent executor, which is not configured",
          );
        }
        return this.inspect(context, tools, workspace);
      }

      case "TEST": {
        if (authoring)
          return this.delegateOrBlock(
            task,
            context,
            session,
            tools,
            scopeOf,
            runChanges,
          );
        const results = await runValidation(
          tools,
          session,
          manager,
          workspace.descriptor.scripts,
          ["typecheck", "lint", "test"],
          this.clock,
        );
        return this.validationOutcome(results, "test");
      }

      case "DEVELOPMENT": {
        if (authoring)
          return this.delegateOrBlock(
            task,
            context,
            session,
            tools,
            scopeOf,
            runChanges,
          );
        const results = await runValidation(
          tools,
          session,
          manager,
          workspace.descriptor.scripts,
          ["build"],
          this.clock,
        );
        return this.validationOutcome(results, "build");
      }

      case "REVIEW":
      case "SECURITY": {
        const changes = runChanges();
        const scope = scopeOf(changes);
        session.scope = scope;
        if (scope.status === "FLAGGED_FOR_REVIEW") {
          manager.emit(session, "execution.scope.flagged", {
            unexpected: scope.unexpected.slice(0, 20),
            sensitive: scope.sensitive.slice(0, 20),
          });
          return {
            kind: "success",
            summary: `Flagged for review: unexpected modifications — ${scope.unexpected.slice(0, 8).join(", ")}${scope.sensitive.length ? ` (sensitive: ${scope.sensitive.join(", ")})` : ""}`,
            evidence: [
              `diff of ${changes.length} change(s)`,
              `unexpected: ${scope.unexpected.join(", ")}`,
            ],
            verdict: "changes_requested",
          };
        }
        return this.delegateOrBlock(
          task,
          context,
          session,
          tools,
          scopeOf,
          runChanges,
        );
      }

      case "INTEGRATION":
        return this.commit(
          task,
          context,
          session,
          tools,
          workspace,
          runChanges,
          scopeOf,
        );

      case "DEPLOYMENT":
        return this.deploy(task, context, runChanges, scopeOf, tools);

      case "DOCUMENTATION":
      case "MAINTENANCE":
        return this.delegateOrBlock(
          task,
          context,
          session,
          tools,
          scopeOf,
          runChanges,
        );
    }
  }

  /** Read-only inspection: the tree, the relevant files and the declared scripts. */
  private async inspect(
    context: TaskExecutionContext,
    tools: AgentToolSession,
    workspace: ResolvedWorkspace,
  ): Promise<RuntimeOutcome> {
    const tree = await tools.tree();
    const read: string[] = [];
    for (const file of context.relevantFiles.slice(0, 5)) {
      try {
        await tools.readFile(file);
        read.push(file);
      } catch (error) {
        if (
          error instanceof ToolDeniedError ||
          error instanceof ExecutionCancelledError ||
          error instanceof ExecutionPausedError
        )
          throw error;
        /* a relevant file that is not in this checkout is reported, not fatal */
      }
    }
    return {
      kind: "success",
      summary: `Inspected the workspace: ${tree.entries.length} entries${tree.truncated ? " (truncated)" : ""}; read ${read.length} relevant file(s).`,
      evidence: [
        `workspace ${workspace.descriptor.workspaceId} (${workspace.descriptor.runtime})`,
        `files read: ${read.join(", ") || "none"}`,
        `scripts: ${workspace.descriptor.scripts.join(", ") || "none"}`,
      ],
    };
  }

  private validationOutcome(
    results: readonly ValidationStageResult[],
    last: "test" | "build",
  ): RuntimeOutcome {
    const failed = results.find((r) => r.status === "failed");
    const unavailable = results.find((r) => r.status === "unavailable");
    if (failed) {
      const where =
        failed.stage === "build"
          ? "BUILD_FAILURE"
          : failed.stage === "test"
            ? "TEST_FAILURE"
            : "CODE_ERROR";
      throw new StageFailed(
        where,
        `${failed.stage} failed (${failed.command}): ${failed.errors.join(" | ") || "see output"}`,
      );
    }
    if (unavailable) {
      return this.failure(
        "ENVIRONMENT_ERROR",
        "APPROVAL",
        `cannot validate: ${unavailable.note ?? `no ${unavailable.stage} command`}`,
      );
    }
    const ran = results.filter((r) => r.status === "passed");
    return {
      kind: "success",
      summary: `${ran.map((r) => r.stage).join(" → ")} passed${
        results.some((r) => r.status === "skipped")
          ? ` (skipped: ${results
              .filter((r) => r.status === "skipped")
              .map((r) => `${r.stage} — ${r.note}`)
              .join("; ")})`
          : ""
      }`,
      evidence: ran
        .map(
          (r) =>
            `${r.command} passed in ${r.durationMs ?? 0}ms${r.counts ? ` (${r.counts.passed}/${r.counts.total} tests)` : ""}`,
        )
        .concat(last === "build" ? ["production build completed"] : []),
      checks: ran.map((r) => ({ name: r.stage, passed: true })),
    };
  }

  private async commit(
    task: OrchTask,
    context: TaskExecutionContext,
    session: RuntimeSession,
    tools: AgentToolSession,
    workspace: ResolvedWorkspace,
    runChanges: () => FileChange[],
    scopeOf: (c: readonly FileChange[]) => ScopeReport,
  ): Promise<RuntimeOutcome> {
    const { manager } = this.deps;
    const changes = netChanges(runChanges());
    // Newest session first: the most recent result of each stage is the one that counts.
    const sessionsNewestFirst = manager.list({ runId: context.runId });
    const latest = (["typecheck", "lint", "test", "build"] as const)
      .map((stage) => {
        for (const s of sessionsNewestFirst) {
          const found = s.validation.find((v) => v.stage === stage);
          if (found) return found;
        }
        return undefined;
      })
      .filter((v): v is ValidationStageResult => v !== undefined);
    const scope = scopeOf(changes);
    session.scope = scope;
    const decision = commitPolicy(
      changes,
      latest,
      scope.status === "FLAGGED_FOR_REVIEW",
    );
    if (!decision.allowed) {
      return this.failure(
        "AUTHORIZATION_ERROR",
        "LOGICAL",
        `commit refused: ${decision.reasons.join("; ")}`,
      );
    }
    if (!context.permittedTools.includes("git.commit")) {
      throw new ToolDeniedError(
        "git.commit",
        'the tool "git.commit" is not authorized for this task (it needs the task approval)',
      );
    }
    const files = [
      ...new Set(
        changes.flatMap((c) => [
          c.path,
          ...(c.renamedFrom ? [c.renamedFrom] : []),
        ]),
      ),
    ];
    const git =
      this.deps.gitFactory?.(workspace) ?? new LocalGitOps(workspace.rootReal);
    const before = await git.state();
    const message = `${context.objective.replace(/\.$/, "").slice(0, 120)}\n\nTask: ${task.taskId}`;
    const result = await git.commit(
      files,
      message.split("\n")[0]!,
      this.identity,
    );
    const after = await git.state();
    session.gitState = after;
    manager.persist(session);
    return {
      kind: "success",
      summary: `Committed ${files.length} file(s) as ${result.sha.slice(0, 8)}.`,
      evidence: [
        `commit ${result.sha}`,
        `files: ${files.join(", ")}`,
        `previous head: ${before.head ?? "none"}`,
      ],
      checks: [{ name: "commit", passed: Boolean(result.sha) }],
    };
  }

  private async deploy(
    task: OrchTask,
    context: TaskExecutionContext,
    runChanges: () => FileChange[],
    scopeOf: (c: readonly FileChange[]) => ScopeReport,
    tools: AgentToolSession,
  ): Promise<RuntimeOutcome> {
    void tools;
    const handoff = this.deps.deployment ?? new UnavailableDeploymentHandoff();
    if (!handoff.available) {
      return this.failure(
        "ENVIRONMENT_ERROR",
        "APPROVAL",
        "the deployment pipeline is not configured; deployment is never run as a command",
      );
    }
    const scope = scopeOf(runChanges());
    if (scope.status === "FLAGGED_FOR_REVIEW") {
      return this.failure(
        "AUTHORIZATION_ERROR",
        "LOGICAL",
        "deployment refused: the change set is flagged for review",
      );
    }
    const ref = await handoff.handoff({
      projectId: task.projectId,
      runId: context.runId,
      taskId: task.taskId,
    });
    return {
      kind: "success",
      summary: "Handed off to the deployment pipeline.",
      evidence: [`deployment reference ${ref.reference}`],
      checks: [{ name: "handoff", passed: true }],
    };
  }

  /* -------------------------------------------------------------- */

  private async delegateOrBlock(
    task: OrchTask,
    context: TaskExecutionContext,
    session: RuntimeSession,
    tools: AgentToolSession,
    scopeOf: (c: readonly FileChange[]) => ScopeReport,
    runChanges: () => FileChange[],
  ): Promise<RuntimeOutcome> {
    if (!this.deps.agentExecutor) {
      return this.failure(
        "ENVIRONMENT_ERROR",
        "APPROVAL",
        "this task needs an agent executor (code generation or review), which is not configured",
      );
    }
    return this.delegate(task, context, session, tools, scopeOf, runChanges);
  }

  private async delegate(
    task: OrchTask,
    context: TaskExecutionContext,
    session: RuntimeSession,
    tools: AgentToolSession,
    scopeOf: (c: readonly FileChange[]) => ScopeReport,
    runChanges: () => FileChange[],
  ): Promise<RuntimeOutcome> {
    const executor = this.deps.agentExecutor!;
    const outcome = await executor.perform({
      task,
      context,
      tools,
      facts: {
        scope: scopeOf(runChanges()),
        changes: runChanges(),
        validation: this.deps.manager
          .list({ runId: context.runId })
          .flatMap((s) => s.validation),
      },
    });
    // After authoring, re-check the scope of everything changed in this run.
    const scope = scopeOf(runChanges());
    session.scope = scope;
    if (scope.status === "FLAGGED_FOR_REVIEW") {
      this.deps.manager.emit(session, "execution.scope.flagged", {
        unexpected: scope.unexpected.slice(0, 20),
        sensitive: scope.sensitive.slice(0, 20),
      });
    }
    return outcome;
  }

  /* -------------------------------------------------------------- */

  private finish(
    session: RuntimeSession,
    outcome: RuntimeOutcome,
  ): RuntimeOutcome {
    const { manager } = this.deps;
    if (session.status === "CANCELLED")
      return this.failure(
        "AGENT_ERROR",
        "APPROVAL",
        "the execution was cancelled",
      );
    if (outcome.kind === "success") {
      if (session.status === "RUNNING")
        manager.transition(session, "REVIEWING");
      manager.transition(session, "SUCCEEDED");
      return outcome;
    }
    manager.transition(session, "FAILED", {
      error: { kind: "TOOL_ERROR", message: outcome.error, at: this.clock() },
    });
    return outcome;
  }

  private fail(session: RuntimeSession, error: unknown): RuntimeOutcome {
    const { manager } = this.deps;
    const mapped = mapError(error);
    if (error instanceof ExecutionPausedError) {
      if (session.status === "RUNNING") manager.transition(session, "PAUSED");
      return this.failure(mapped.kind, mapped.failure, mapped.message);
    }
    if (error instanceof ExecutionCancelledError) {
      if (
        session.status !== "CANCELLED" &&
        !["SUCCEEDED", "FAILED", "TIMED_OUT"].includes(session.status)
      ) {
        manager.transition(session, "CANCELLED");
      }
      return this.failure(mapped.kind, mapped.failure, mapped.message);
    }
    const target = mapped.kind === "TIMEOUT" ? "TIMED_OUT" : "FAILED";
    if (
      !["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(
        session.status,
      )
    ) {
      const err = {
        kind: mapped.kind,
        message: mapped.message,
        at: this.clock(),
      };
      // WAITING_APPROVAL is a legal waypoint for authorization problems.
      if (
        mapped.kind === "AUTHORIZATION_ERROR" &&
        mapped.failure === "APPROVAL" &&
        session.status === "RUNNING"
      ) {
        manager.emit(session, "execution.approval.requested", {
          reason: mapped.message,
        });
        session.approval = { reason: mapped.message };
      }
      manager.transition(session, target, { error: err });
    }
    return this.failure(mapped.kind, mapped.failure, mapped.message);
  }

  private failure(
    kind: RuntimeErrorKind,
    failure: FailureClass,
    message: string,
  ): RuntimeOutcome {
    void kind;
    return {
      kind: "failure",
      error: maskSecrets(message).slice(0, 900),
      classification: failure,
    };
  }
}

function keywordsOf(context: TaskExecutionContext): string[] {
  const words =
    `${context.objective}`.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [];
  const stop = new Set([
    "reduce",
    "vertical",
    "dimensions",
    "padding",
    "spacing",
    "change",
    "make",
    "smaller",
    "request",
    "limited",
    "scope",
    "preserve",
    "task",
    "with",
    "that",
    "from",
  ]);
  return [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 12);
}

export { extractErrors };
