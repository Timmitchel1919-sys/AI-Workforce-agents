/**
 * Runtime tools (Layer 5): the catalog, and the per-execution tool session an
 * agent works through.
 *
 * An agent never touches the host. Every call goes through `AgentToolSession`,
 * which (1) stops if the execution was cancelled or paused, (2) checks the tool
 * is in the set Layer 4 authorized for THIS task, (3) applies the file/command
 * policy, (4) records a secret-free `ToolExecutionRecord`, and (5) emits events.
 */
import { randomBytes } from "node:crypto";
import {
  RUNTIME_LIMITS,
  type CommandRecord,
  type CommandSpec,
  type FileChange,
  type RuntimeSession,
  type ToolExecutionRecord,
  type ValidationStageResult,
  type RuntimeWorkspaceOperation,
} from "../../contracts/execution-runtime.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
import { classifyCommand, displayOf, timeoutFor } from "./command-policy.js";
import { PathRefusedError } from "./path-guard.js";
import type { ProcessRunner } from "./process-runner.js";
import type { SessionManager } from "./session-manager.js";
import type { GitOps } from "./git-ops.js";
import {
  ApprovalRequiredError,
  GovernedFileSystem,
  type ResolvedWorkspace,
} from "./workspace.js";

/* ------------------------------------------------------------------ */
/* Catalog                                                            */
/* ------------------------------------------------------------------ */

export interface RuntimeToolDefinition {
  id: string;
  name: string;
  /** Capability taxonomy id of the agent role this tool is meant for. */
  capability: string;
  risk: "low" | "medium" | "high";
  operations: readonly string[];
  /** Workspace operations the tool needs the workspace to permit. */
  permissions: readonly RuntimeWorkspaceOperation[];
  input: string;
  output: string;
}

export const RUNTIME_TOOLS: readonly RuntimeToolDefinition[] = Object.freeze([
  {
    id: "repo.read",
    name: "Read repository",
    capability: "software.general",
    risk: "low",
    operations: ["tree", "read"],
    permissions: ["read", "list"],
    input: "{ path }",
    output: "{ content, hash, size }",
  },
  {
    id: "docs.read",
    name: "Read documentation",
    capability: "research",
    risk: "low",
    operations: ["tree", "read"],
    permissions: ["read", "list"],
    input: "{ path }",
    output: "{ content }",
  },
  {
    id: "repo.edit",
    name: "Edit repository files",
    capability: "software.general",
    risk: "medium",
    operations: ["create", "update", "rename", "move"],
    permissions: ["create", "update", "rename", "move"],
    input: "{ path, content, expectedHash? }",
    output: "{ change }",
  },
  {
    id: "repo.delete",
    name: "Delete repository files",
    capability: "software.general",
    risk: "high",
    operations: ["delete"],
    permissions: ["delete"],
    input: "{ path }",
    output: "{ change } (approval required)",
  },
  {
    id: "tests.run",
    name: "Run tests / lint / typecheck",
    capability: "software.testing",
    risk: "low",
    operations: ["run_script"],
    permissions: ["run_script"],
    input: "{ script }",
    output: "{ exitCode, output }",
  },
  {
    id: "build.run",
    name: "Run build",
    capability: "software.general",
    risk: "low",
    operations: ["run_script"],
    permissions: ["run_script"],
    input: "{ script }",
    output: "{ exitCode, output }",
  },
  {
    id: "diff.read",
    name: "Read diff",
    capability: "software.review",
    risk: "low",
    operations: ["diff"],
    permissions: ["git_read"],
    input: "{}",
    output: "{ changes }",
  },
  {
    id: "security.scan",
    name: "Security scan (read-only)",
    capability: "software.security",
    risk: "low",
    operations: ["scan"],
    permissions: ["read"],
    input: "{}",
    output: "{ findings }",
  },
  {
    id: "integration.use",
    name: "Use an integration capability",
    capability: "software.general",
    risk: "medium",
    operations: ["discover", "invoke"],
    permissions: [],
    input: "{ capability, parameters, resource? }",
    output: "{ success, data?, error? }",
  },
  {
    id: "git.status",
    name: "Git status",
    capability: "integration.github",
    risk: "low",
    operations: ["status"],
    permissions: ["git_read"],
    input: "{}",
    output: "{ state }",
  },
  {
    id: "git.diff",
    name: "Git diff",
    capability: "integration.github",
    risk: "low",
    operations: ["diff"],
    permissions: ["git_read"],
    input: "{}",
    output: "{ output }",
  },
  {
    id: "git.commit",
    name: "Git commit (governed)",
    capability: "integration.github",
    risk: "medium",
    operations: ["commit"],
    permissions: ["git_write"],
    input: "{ message }",
    output: "{ sha }",
  },
  {
    id: "git.push",
    name: "Git push (governed, fast-forward)",
    capability: "integration.github",
    risk: "high",
    operations: ["push"],
    permissions: ["git_write"],
    input: "{ branch }",
    output: "{ result }",
  },
]);

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

export class ToolDeniedError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolDeniedError";
  }
}
export class CommandRefusedError extends Error {
  constructor(
    readonly commandClass: "REVIEW_REQUIRED" | "BLOCKED",
    message: string,
  ) {
    super(message);
    this.name = "CommandRefusedError";
  }
}
export class ExecutionCancelledError extends Error {
  constructor() {
    super("the execution was cancelled");
    this.name = "ExecutionCancelledError";
  }
}
export class ExecutionPausedError extends Error {
  constructor() {
    super("the execution is paused");
    this.name = "ExecutionPausedError";
  }
}
export class CommandTimeoutError extends Error {
  constructor(display: string) {
    super(`${display} timed out`);
    this.name = "CommandTimeoutError";
  }
}

/* ------------------------------------------------------------------ */
/* Tool session                                                       */
/* ------------------------------------------------------------------ */

/* ---- governance gate (Layer 7) ---- */

export interface GateInput {
  projectId: string;
  executionId: string;
  taskId: string;
  agentId: string;
  modelId?: string;
  taskType?: string;
  toolId: string;
  action: string;
  resource: string;
  command?: string;
  content?: string;
  count?: number;
  expectedScope?: readonly string[];
  environment?: string;
}
export interface GateVerdict {
  effect:
    | "ALLOW"
    | "REQUIRE_REVIEW"
    | "REQUIRE_SECURITY_REVIEW"
    | "REQUIRE_APPROVAL"
    | "DENY";
  risk: string;
  reasons: string[];
  explanation: string;
  policies: string[];
  approvalId?: string;
}
/** The policy decision point the runtime asks BEFORE every file write, delete, command or git action. */
export interface ActionGate {
  check(input: GateInput): Promise<GateVerdict>;
  noteRefusal?(note: {
    kind: "command" | "path";
    detail: string;
    agentId: string;
    projectId: string;
    taskId: string;
    executionId: string;
  }): void;
}

export class PolicyDeniedError extends Error {
  constructor(
    message: string,
    readonly verdict?: GateVerdict,
  ) {
    super(message);
    this.name = "PolicyDeniedError";
  }
}
export class PolicyApprovalRequiredError extends Error {
  constructor(
    message: string,
    readonly approvalId: string | undefined,
    readonly verdict?: GateVerdict,
  ) {
    super(message);
    this.name = "PolicyApprovalRequiredError";
  }
}

/** The integration hub as the runtime sees it. Agents get capabilities, never providers or credentials. */
export interface CapabilityPort {
  discover(projectId: string): {
    capability: string;
    description: string;
    operation: string;
    risk: string;
    approval: string;
    available: boolean;
    reason?: string;
  }[];
  invoke(request: {
    capability: string;
    projectId: string;
    agentId: string;
    taskId: string;
    executionId: string;
    taskType?: string;
    resource?: string;
    parameters: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    data?: unknown;
    error?: {
      kind: string;
      message: string;
      retryable: boolean;
      approvalId?: string;
    };
    connectorId?: string;
  }>;
}

export interface ToolSessionDeps {
  /** The integration hub (Layer 8). Absent when no hub is composed. */
  capabilities?: CapabilityPort;
  /** Layer 7: the governance gate. Absent only in tests of the bare runtime. */
  gate?: ActionGate;
  taskType?: string;
  expectedScope?: readonly string[];
  modelId?: string;
  session: RuntimeSession;
  manager: SessionManager;
  workspace: ResolvedWorkspace;
  permittedTools: readonly string[];
  /** The task's own human approval was granted (unlocks destructive file ops). */
  approved: boolean;
  runner: ProcessRunner;
  git: GitOps;
  clock: () => string;
  /** Upper bound on any command (tests and tight deployments). */
  maxCommandMs?: number;
}

export class AgentToolSession {
  readonly fs: GovernedFileSystem;
  private readonly permitted: Set<string>;

  constructor(private readonly deps: ToolSessionDeps) {
    this.permitted = new Set(deps.permittedTools);
    this.fs = new GovernedFileSystem(
      deps.workspace.rootReal,
      deps.workspace.binding.permittedOperations,
      {
        taskId: deps.session.taskId,
        agentId: deps.session.agentId,
        clock: deps.clock,
      },
    );
  }

  get permittedTools(): string[] {
    return [...this.permitted];
  }

  /* ---- reads ---- */

  tree(dir?: string) {
    return this.guard("repo.read", "tree", async () => {
      await this.enforce("repo.read", "READ", `file:${dir ?? "."}`);
      return this.fs.tree(dir);
    });
  }
  readFile(path: string) {
    return this.guard("repo.read", "read", async () => {
      await this.enforce("repo.read", "READ", `file:${path}`);
      return this.fs.read(path);
    });
  }

  /* ---- writes ---- */

  createFile(path: string, content: string) {
    return this.guard("repo.edit", "create", async () => {
      await this.enforce("repo.edit", "CREATE", `file:${path}`, { content });
      return this.track(await this.fs.create(path, content));
    });
  }
  updateFile(path: string, content: string, expectedHash?: string) {
    return this.guard("repo.edit", "update", async () => {
      await this.enforce("repo.edit", "UPDATE", `file:${path}`, { content });
      return this.track(await this.fs.update(path, content, expectedHash));
    });
  }
  renameFile(from: string, to: string) {
    return this.guard("repo.edit", "rename", async () => {
      await this.enforce("repo.edit", "UPDATE", `file:${from}`);
      await this.enforce("repo.edit", "CREATE", `file:${to}`);
      return this.track(await this.fs.rename(from, to, "rename"));
    });
  }
  moveFile(from: string, to: string) {
    return this.guard("repo.edit", "move", async () => {
      await this.enforce("repo.edit", "UPDATE", `file:${from}`);
      await this.enforce("repo.edit", "CREATE", `file:${to}`);
      return this.track(await this.fs.rename(from, to, "move"));
    });
  }
  deleteFile(path: string) {
    return this.guard("repo.delete", "delete", async () => {
      await this.enforce("repo.delete", "DELETE", `file:${path}`);
      return this.track(await this.fs.delete(path, this.deps.approved));
    });
  }

  /* ---- inspection ---- */

  diff(): Promise<{ changes: FileChange[] }> {
    return this.guard("diff.read", "diff", async () => ({
      changes: structuredClone(this.deps.session.changes),
    }));
  }
  gitState() {
    return this.guard("git.status", "status", () => this.deps.git.state());
  }

  /* ---- commands ---- */

  /** Run an allow-listed command. Anything else is refused, never executed. */
  runCommand(line: string): Promise<CommandRecord> {
    const verdict = classifyCommand(line, {
      scripts: this.deps.workspace.descriptor.scripts,
    });
    if (verdict.class !== "SAFE" || !verdict.spec) {
      this.record("command", "classify", "denied", verdict.reason, 0);
      if (verdict.class === "BLOCKED")
        this.refusal("command", String(line).slice(0, 120));
      this.deps.manager.emit(this.deps.session, "execution.command.started", {
        command: String(line).slice(0, 120),
        class: verdict.class,
        refused: true,
        reason: verdict.reason,
      });
      return Promise.reject(
        new CommandRefusedError(
          verdict.class === "BLOCKED" ? "BLOCKED" : "REVIEW_REQUIRED",
          verdict.reason,
        ),
      );
    }
    return this.runSpec(verdict.spec);
  }

  runSpec(spec: CommandSpec): Promise<CommandRecord> {
    const tool = toolFor(spec);
    return this.guard(tool, "run_script", async () => {
      await this.enforce(tool, "EXECUTE", `command:${displayOf(spec)}`, {
        command: displayOf(spec),
      });
      return this.execute(spec);
    });
  }

  /** Ask the governance gate (if any) and act on its verdict. */
  async enforce(
    toolId: string,
    action: string,
    resource: string,
    extra: {
      content?: string;
      command?: string;
      count?: number;
      environment?: string;
    } = {},
  ): Promise<GateVerdict | undefined> {
    const gate = this.deps.gate;
    if (!gate) return undefined;
    const { session, manager } = this.deps;
    const v = await gate.check({
      projectId: session.projectId,
      executionId: session.executionId,
      taskId: session.taskId,
      agentId: session.agentId,
      ...(this.deps.modelId ? { modelId: this.deps.modelId } : {}),
      ...(this.deps.taskType ? { taskType: this.deps.taskType } : {}),
      ...(this.deps.expectedScope
        ? { expectedScope: this.deps.expectedScope }
        : {}),
      toolId,
      action,
      resource,
      ...extra,
    });
    if (v.effect === "ALLOW") return v;
    if (v.effect === "REQUIRE_REVIEW") {
      const flags = session.governance?.reviewRequired ?? [];
      session.governance = {
        ...(session.governance ?? { reviewRequired: [] }),
        reviewRequired: [...flags, `${action} ${resource}`].slice(-50),
      };
      manager.persist(session);
      return v;
    }
    if (v.effect === "DENY") throw new PolicyDeniedError(v.explanation, v);
    manager.emit(session, "execution.approval.requested", {
      approvalId: v.approvalId ?? "",
      reason: v.explanation.slice(0, 300),
      action,
      resource,
    });
    throw new PolicyApprovalRequiredError(
      `approval required: ${v.explanation}`,
      v.approvalId,
      v,
    );
  }

  private refusal(kind: "command" | "path", detail: string): void {
    const { session } = this.deps;
    try {
      this.deps.gate?.noteRefusal?.({
        kind,
        detail,
        agentId: session.agentId,
        projectId: session.projectId,
        taskId: session.taskId,
        executionId: session.executionId,
      });
    } catch {
      /* reporting must never change the refusal */
    }
  }

  /** What can be asked of the integration hub in this project. */
  listCapabilities() {
    return this.guard("integration.use", "discover", async () => {
      const port = this.deps.capabilities;
      if (!port) return [];
      return port.discover(this.deps.session.projectId);
    });
  }

  /**
   * Ask the integration hub for a capability. Denials and approvals surface as the same errors as any
   * other governed tool; other failures come back as a result the agent can read.
   */
  useCapability(
    capability: string,
    parameters: Record<string, unknown>,
    resource?: string,
  ) {
    return this.guard("integration.use", "invoke", async () => {
      const port = this.deps.capabilities;
      if (!port)
        throw new ToolDeniedError(
          "integration.use",
          "no integration hub is configured for this runtime",
        );
      const { session } = this.deps;
      const r = await port.invoke({
        capability,
        projectId: session.projectId,
        agentId: session.agentId,
        taskId: session.taskId,
        executionId: session.executionId,
        ...(this.deps.taskType ? { taskType: this.deps.taskType } : {}),
        ...(resource ? { resource } : {}),
        parameters,
      });
      if (!r.success && r.error?.kind === "APPROVAL_REQUIRED")
        throw new PolicyApprovalRequiredError(
          `approval required: ${r.error.message}`,
          r.error.approvalId,
        );
      if (
        !r.success &&
        (r.error?.kind === "POLICY_DENIED" || r.error?.kind === "NOT_MAPPED")
      )
        throw new PolicyDeniedError(r.error.message);
      return r;
    });
  }

  /** Throws when the execution was cancelled or paused; otherwise a heartbeat. */
  checkpoint(): void {
    const { session, manager } = this.deps;
    if (
      manager.signal(session.executionId)?.aborted ||
      session.status === "CANCELLED"
    )
      throw new ExecutionCancelledError();
    if (session.paused) throw new ExecutionPausedError();
    manager.heartbeat(session);
  }

  /** Record a masked, bounded progress event (used by the agent loop). */
  note(data: Record<string, unknown>): void {
    this.deps.manager.emit(this.deps.session, "execution.agent.step", data);
    this.deps.manager.heartbeat(this.deps.session);
  }

  private async execute(spec: CommandSpec): Promise<CommandRecord> {
    const { session, manager } = this.deps;
    if (
      !this.deps.workspace.binding.permittedOperations.includes(
        spec.kind === "git" ? "git_read" : "run_script",
      )
    ) {
      throw new ToolDeniedError(
        "command",
        "the workspace does not permit this kind of command",
      );
    }
    const commandId = `cmd-${randomBytes(4).toString("hex")}`;
    const display = displayOf(spec);
    const startedAt = this.deps.clock();
    manager.emit(session, "execution.command.started", {
      commandId,
      command: display,
      class: "SAFE",
    });
    const result = await this.deps.runner.run({
      spec,
      cwd: this.deps.workspace.rootReal,
      timeoutMs: Math.min(
        timeoutFor(spec),
        this.deps.maxCommandMs ?? Number.MAX_SAFE_INTEGER,
      ),
      ...(manager.signal(session.executionId)
        ? { signal: manager.signal(session.executionId)! }
        : {}),
      onChunk: (chunk) =>
        manager.emit(session, "execution.command.output", {
          commandId,
          chunk: chunk.slice(0, 2000),
        }),
    });
    const record: CommandRecord = {
      commandId,
      display,
      spec,
      class: "SAFE",
      startedAt,
      completedAt: this.deps.clock(),
      ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      output: result.output,
      truncated: result.truncated,
    };
    session.commands.push(record);
    if (session.commands.length > RUNTIME_LIMITS.maxCommands)
      session.commands.shift();
    manager.emit(session, "execution.command.completed", {
      commandId,
      command: display,
      exitCode: result.exitCode ?? null,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
    });
    manager.persist(session);
    if (result.cancelled) throw new ExecutionCancelledError();
    if (result.timedOut) throw new CommandTimeoutError(display);
    return record;
  }

  /* ---- plumbing ---- */

  private track(change: FileChange): { change: FileChange } {
    const { session, manager } = this.deps;
    session.changes.push(change);
    if (session.changes.length > RUNTIME_LIMITS.maxChanges)
      session.changes.shift();
    manager.emit(session, "execution.file.changed", {
      path: change.path,
      operation: change.operation,
    });
    manager.persist(session);
    return { change };
  }

  private async guard<T>(
    tool: string,
    operation: string,
    work: () => Promise<T> | T,
  ): Promise<T> {
    const { session, manager } = this.deps;
    const signal = manager.signal(session.executionId);
    if (signal?.aborted || session.status === "CANCELLED")
      throw new ExecutionCancelledError();
    if (session.paused) throw new ExecutionPausedError();
    if (!this.permitted.has(tool)) {
      this.record(
        tool,
        operation,
        "denied",
        "tool is not authorized for this task",
        0,
      );
      throw new ToolDeniedError(
        tool,
        `the tool "${tool}" is not authorized for this task`,
      );
    }
    manager.heartbeat(session);
    const started = Date.now();
    try {
      const value = await work();
      this.record(tool, operation, "ok", undefined, Date.now() - started);
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : "tool error";
      if (error instanceof PathRefusedError)
        this.refusal("path", message.slice(0, 120));
      const denied =
        error instanceof PathRefusedError ||
        error instanceof ApprovalRequiredError ||
        error instanceof ToolDeniedError ||
        error instanceof PolicyDeniedError ||
        error instanceof PolicyApprovalRequiredError;
      this.record(
        tool,
        operation,
        denied ? "denied" : "error",
        message,
        Date.now() - started,
      );
      throw error;
    }
  }

  private record(
    tool: string,
    operation: string,
    result: ToolExecutionRecord["result"],
    error: string | undefined,
    durationMs: number,
  ): void {
    const { session } = this.deps;
    session.tools.push({
      executionId: session.executionId,
      taskId: session.taskId,
      agentId: session.agentId,
      tool,
      operation,
      at: this.deps.clock(),
      result,
      ...(error ? { error: maskSecrets(error).slice(0, 300) } : {}),
      durationMs,
    });
    if (session.tools.length > RUNTIME_LIMITS.maxTools) session.tools.shift();
  }
}

function toolFor(spec: CommandSpec): string {
  if (spec.kind === "git")
    return spec.sub === "diff" ? "git.diff" : "git.status";
  if (spec.kind === "script")
    return spec.script === "build" ? "build.run" : "tests.run";
  return "build.run";
}

/* ------------------------------------------------------------------ */
/* Validation pipeline                                                */
/* ------------------------------------------------------------------ */

export function parseTestCounts(
  output: string,
): ValidationStageResult["counts"] | undefined {
  const node =
    /ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)(?:[\s\S]*?ℹ skipped (\d+))?/.exec(
      output,
    );
  if (node)
    return {
      total: +node[1]!,
      passed: +node[2]!,
      failed: +node[3]!,
      skipped: +(node[4] ?? 0),
    };
  const vitest =
    /Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed(?:\s*\|\s*(\d+) skipped)?\s*\((\d+)\)/.exec(
      output,
    );
  if (vitest)
    return {
      total: +vitest[4]!,
      passed: +vitest[2]!,
      failed: +(vitest[1] ?? 0),
      skipped: +(vitest[3] ?? 0),
    };
  const jest =
    /Tests:\s+(?:(\d+) failed,\s*)?(?:(\d+) skipped,\s*)?(?:(\d+) passed,\s*)?(\d+) total/.exec(
      output,
    );
  if (jest)
    return {
      total: +jest[4]!,
      passed: +(jest[3] ?? 0),
      failed: +(jest[1] ?? 0),
      skipped: +(jest[2] ?? 0),
    };
  return undefined;
}

export function extractErrors(output: string, max = 8): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /error\b|✖|\bFAIL\b|failed|TS\d{4}/i.test(l))
    .slice(0, max)
    .map((l) => l.slice(0, 200));
}

const STAGE_SCRIPTS: Readonly<Record<string, readonly string[]>> = {
  typecheck: ["typecheck", "type-check"],
  lint: ["lint"],
  test: ["test"],
  build: ["build"],
};

/**
 * CODE → TYPE CHECK → LINT → TEST → BUILD. A failed stage stops the pipeline;
 * later stages are reported as skipped (never silently). A missing script is
 * reported as such: missing typecheck/lint are skipped, a missing test or
 * build is "unavailable" (not a pass).
 */
export async function runValidation(
  tools: AgentToolSession,
  session: RuntimeSession,
  manager: SessionManager,
  scripts: readonly string[],
  stages: readonly ("typecheck" | "lint" | "test" | "build")[],
  clock: () => string,
): Promise<ValidationStageResult[]> {
  const results: ValidationStageResult[] = [];
  let stopped = false;
  for (const stage of stages) {
    const script = STAGE_SCRIPTS[stage]!.find((s) => scripts.includes(s));
    if (stopped) {
      results.push({
        stage,
        status: "skipped",
        note: "a previous stage failed",
        errors: [],
        warnings: 0,
        completedAt: clock(),
      });
      continue;
    }
    if (!script) {
      results.push({
        stage,
        status:
          stage === "test" || stage === "build" ? "unavailable" : "skipped",
        note: `the workspace declares no ${stage} script`,
        errors: [],
        warnings: 0,
        completedAt: clock(),
      });
      continue;
    }
    const kind =
      stage === "test" ? "test" : stage === "build" ? "build" : undefined;
    if (kind)
      manager.emit(
        session,
        kind === "test" ? "execution.test.started" : "execution.build.started",
        { script },
      );
    session.currentOperation = `npm run ${script}`;
    let record: CommandRecord | undefined;
    let thrown: unknown;
    try {
      record = await tools.runSpec({ kind: "script", script });
    } catch (error) {
      thrown = error;
    }
    const output = record?.output ?? "";
    const failed = thrown !== undefined || record?.exitCode !== 0;
    const result: ValidationStageResult = {
      stage,
      status: failed ? "failed" : "passed",
      command: `npm run ${script}`,
      ...(record?.durationMs !== undefined
        ? { durationMs: record.durationMs }
        : {}),
      completedAt: clock(),
      ...(stage === "test" ? { counts: parseTestCounts(output) } : {}),
      errors: failed
        ? thrown instanceof Error && !output
          ? [maskSecrets(thrown.message)]
          : extractErrors(output)
        : [],
      warnings: (output.match(/warning/gi) ?? []).length,
    };
    if (result.counts === undefined) delete result.counts;
    results.push(result);
    session.validation = [
      ...session.validation.filter((v) => v.stage !== stage),
      result,
    ];
    if (kind) {
      manager.emit(
        session,
        kind === "test"
          ? "execution.test.completed"
          : "execution.build.completed",
        {
          status: result.status,
          durationMs: result.durationMs ?? 0,
          ...(result.counts ? { counts: result.counts } : {}),
        },
      );
    }
    manager.persist(session);
    if (failed) {
      // Cancellation/timeout propagate; an ordinary failure stops the pipeline.
      if (
        thrown instanceof ExecutionCancelledError ||
        thrown instanceof ExecutionPausedError ||
        thrown instanceof CommandTimeoutError
      )
        throw thrown;
      stopped = true;
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Commit / push policy                                               */
/* ------------------------------------------------------------------ */

export interface GateDecision {
  allowed: boolean;
  reasons: string[];
}

/**
 * Before commit: there are changes, the change stayed in scope, validation
 * (test + build) PASSED after the last change, and nothing looks like a
 * credential. Failed or unverified work is not committed.
 */
export function commitPolicy(
  runChanges: readonly FileChange[],
  validation: readonly ValidationStageResult[],
  scopeFlagged: boolean,
): GateDecision {
  const reasons: string[] = [];
  if (runChanges.length === 0) reasons.push("there are no changes to commit");
  if (scopeFlagged)
    reasons.push("the change set was flagged for review (unexpected files)");
  if (runChanges.some((c) => c.diff?.includes("[masked]")))
    reasons.push("a change appears to contain a credential");
  const lastChange = runChanges.reduce((t, c) => (c.at > t ? c.at : t), "");
  for (const stage of ["test", "build"] as const) {
    const result = validation.find((v) => v.stage === stage);
    if (!result) reasons.push(`${stage} has not been run`);
    else if (result.status !== "passed")
      reasons.push(`${stage} did not pass (${result.status})`);
    else if (lastChange !== "" && (result.completedAt ?? "") < lastChange)
      reasons.push(`${stage} passed before the last change (stale)`);
  }
  return { allowed: reasons.length === 0, reasons };
}

/** Push adds: correct repository + branch, and an existing verified commit. */
export function pushPolicy(
  commit: GateDecision,
  input: {
    branch: string;
    workspaceBranch?: string;
    repository?: string;
    hasCommit: boolean;
  },
): GateDecision {
  const reasons = [...commit.reasons.filter((r) => !/no changes/.test(r))];
  if (!input.hasCommit) reasons.push("there is no commit to push");
  if (!input.repository)
    reasons.push("the workspace is not bound to a repository");
  if (input.workspaceBranch && input.branch !== input.workspaceBranch)
    reasons.push("the branch is not the workspace branch");
  return { allowed: reasons.length === 0, reasons };
}
