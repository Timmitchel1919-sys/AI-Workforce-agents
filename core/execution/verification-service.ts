/**
 * EO-4.4 VerificationService — controlled build, test & verification.
 *
 *   BUILD/TEST EXECUTION IS BOUNDED · NO GENERAL-PURPOSE TERMINAL ·
 *   VERIFIED ≠ COMMITTED ≠ PUSHED ≠ DEPLOYED
 *
 * Runs the build, test and security stages an exact ExecutionPlan revision
 * already contains, through REGISTERED operations mapped by a trusted
 * per-project VerificationProfile. Every stage is its own ExecutionManager
 * session (pre-flight, policy, environment + toolchain revalidation, sandbox
 * selection, limits, receipts) — this service adds ordering, bounded
 * parallelism, fail-fast, bounded retries of TRANSIENT failures, source
 * fingerprinting, artifact integrity and an immutable result. It never
 * commits, pushes, merges or deploys, and deployment stages are never run.
 */
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  isTerminalSession,
  operationWorkspaceAccess,
  operatorCan,
  operatorCanAccessProject,
  requireExecutionId,
  validateVerificationProfile,
  type ExecutionOperationDefinition,
  type ExecutionPlanReference,
  type ExecutionReason,
  type ExecutionStageKind,
  type InvocationResult,
  type OperatorPrincipal,
  type SecurityFindingSummary,
  type StageFailureKind,
  type StageProfile,
  type StageRun,
  type ToolchainObservation,
  type VerificationProfile,
  type VerificationResult,
  type VerificationStatus,
  type WorkspaceControl,
  type ExecutionRecordStore,
} from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { EnvironmentRegistry } from "../environments/environment-registry.js";
import type { ExecutionPlanningService } from "../planning/execution-planning-service.js";
import { createId, now } from "../shared.js";
import type { ArtifactManager } from "./artifact-manager.js";
import type { ExecutionManager } from "./execution-manager.js";
import type { ExecutionOperationRegistry } from "./execution-operations.js";
import type { SandboxRegistry } from "./sandbox.js";

export interface VerificationServiceOptions {
  manager: Pick<
    ExecutionManager,
    "createSession" | "invoke" | "cancel" | "getSession" | "getChangeSet"
  >;
  planning: Pick<ExecutionPlanningService, "get" | "latest">;
  operations: Pick<ExecutionOperationRegistry, "get">;
  environments: Pick<EnvironmentRegistry, "getInstance">;
  sandboxes: Pick<SandboxRegistry, "get">;
  projects: { has(projectId: string): boolean };
  audit: AuditLog;
  artifacts: ArtifactManager;
  workspaceControl?: WorkspaceControl;
  /** Simultaneous verifications per project. Default 1. */
  maxConcurrentPerProject?: number;
  /** Bounded, redacted log excerpt kept per stage. Default 16 KiB. */
  maxLogBytes?: number;
  /**
   * EO-4.8: terminal results are written here (awaited) so verification
   * history and the evidence behind commits survive restarts.
   */
  store?: ExecutionRecordStore;
  clock?: () => string;
  idFactory?: (prefix: string) => string;
}

export interface StartVerificationRequest {
  projectId: string;
  planId: string;
  planVersion: number;
  /** Completed developer session whose ChangeSet is being verified. */
  sourceSessionId?: string;
}

const START_KEYS = ["projectId", "planId", "planVersion", "sourceSessionId"];

interface PlannedStage {
  stageId: string;
  kind: ExecutionStageKind;
  category?: string;
  planDependsOn: readonly string[];
}

interface RunState {
  result: VerificationResult;
  principal: OperatorPrincipal;
  cancelRequested?: { by: string; reason: string };
  activeSessions: Set<string>;
  done: Promise<VerificationResult>;
}

/** Verification-level reasons (not session denial codes). */
type VerificationReason = VerificationResult["reasons"][number];

/** Deny reason codes that map 1:1 onto a stage failure kind. */
const DENIAL_KINDS: readonly StageFailureKind[] = [
  "TOOLCHAIN_UNAVAILABLE",
  "DEPENDENCY_MISSING",
  "ENVIRONMENT_UNAVAILABLE",
  "SANDBOX_UNAVAILABLE",
  "POLICY_DENIED",
];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) {
      deepFreeze(inner);
    }
  }
  return value;
}

export class VerificationService {
  private readonly clock: () => string;
  private readonly newId: (prefix: string) => string;
  private readonly profiles = new Map<string, VerificationProfile>();
  private readonly runs = new Map<string, RunState>();
  private readonly byKey = new Map<string, string>();

  constructor(private readonly options: VerificationServiceOptions) {
    this.clock = options.clock ?? now;
    this.newId = options.idFactory ?? createId;
  }

  /** Trusted composition only — agents and the API cannot set profiles. */
  registerProfile(profile: VerificationProfile): void {
    validateVerificationProfile(profile);
    for (const stage of Object.values(profile.stages)) {
      if (!this.options.operations.get(stage.operationId)) {
        throw new ValidationError(
          `profile operation ${stage.operationId} is not registered`,
        );
      }
    }
    this.profiles.set(profile.projectId, deepFreeze(structuredClone(profile)));
  }

  /* -------------------------------------------------------------- */
  /* Authorization                                                  */
  /* -------------------------------------------------------------- */

  private authorize(
    principal: OperatorPrincipal,
    projectId: string,
    capability: "prepare_execution" | "view" | "cancel_execution",
  ): void {
    // Scope first: invisible and nonexistent projects look identical.
    if (
      !operatorCanAccessProject(principal, projectId) ||
      !this.options.projects.has(projectId)
    ) {
      throw new NotFoundError("resource not found");
    }
    if (!operatorCan(principal, capability)) {
      throw new PermissionDeniedError(
        `operator ${principal.id} lacks the ${capability} capability`,
      );
    }
  }

  private record(
    action: string,
    actor: string,
    projectId: string,
    data: Record<string, unknown>,
  ): void {
    this.options.audit.record("execution_event", {
      projectId,
      data: { ...data, action, actor },
    });
  }

  /* -------------------------------------------------------------- */
  /* Start                                                          */
  /* -------------------------------------------------------------- */

  /**
   * Validate and start a verification. Returns immediately with the pending
   * record; `wait(id)` resolves with the immutable terminal result. Structural
   * problems (unknown dependency, cycle, bad request) throw BEFORE anything
   * executes. Idempotent per `(operator, idempotencyKey)`.
   */
  async start(
    principal: OperatorPrincipal,
    raw: unknown,
    idempotencyKey: string,
  ): Promise<VerificationResult> {
    const request = this.validateStart(raw);
    this.authorize(principal, request.projectId, "prepare_execution");
    const key = `${principal.id}\u0000${requireExecutionId(idempotencyKey, "idempotencyKey")}`;
    const existingId = this.byKey.get(key);
    if (existingId) {
      const existing = this.runs.get(existingId)!;
      if (
        existing.result.projectId !== request.projectId ||
        existing.result.plan.planId !== request.planId ||
        existing.result.plan.version !== request.planVersion
      ) {
        throw new StateTransitionError(
          "idempotency key was already used for a different verification",
        );
      }
      return existing.result;
    }

    const planDocId = `${request.planId}@v${request.planVersion}`;
    const plan = this.options.planning.get(planDocId);
    if (!plan || plan.projectId !== request.projectId) {
      throw new NotFoundError("resource not found");
    }
    const running = [...this.runs.values()].filter(
      (r) =>
        r.result.projectId === request.projectId &&
        (r.result.status === "running" || r.result.status === "pending"),
    ).length;
    if (running >= (this.options.maxConcurrentPerProject ?? 1)) {
      throw new StateTransitionError(
        "the project already has the maximum number of running verifications",
      );
    }

    const planned: PlannedStage[] = [
      ...plan.build.map((b) => ({
        stageId: b.id,
        kind: "build" as const,
        planDependsOn: [] as readonly string[],
      })),
      ...plan.tests.map((t) => ({
        stageId: t.id,
        kind: "test" as const,
        category: t.type,
        planDependsOn: t.dependsOnStageIds,
      })),
      ...plan.security.map((s) => ({
        stageId: s.id,
        kind: "security" as const,
        category: s.check,
        planDependsOn: [] as readonly string[],
      })),
    ];
    const profile = this.profiles.get(request.projectId);
    const graph = profile
      ? this.validateGraph(planned, profile)
      : { order: [], deps: new Map<string, string[]>() };

    // ChangeSet correlation: the developer session must have ENDED (its
    // workspace lease released) — verification never races the author.
    let changeSet: { changeSetId: string; workspaceId: string } | undefined;
    if (request.sourceSessionId) {
      const source = await this.options.manager.getSession(
        principal,
        request.sourceSessionId,
      );
      if (source.projectId !== request.projectId) {
        throw new NotFoundError("resource not found");
      }
      if (!isTerminalSession(source.status)) {
        throw new StateTransitionError(
          "complete the developer session before verifying its ChangeSet",
        );
      }
      const cs = await this.options.manager.getChangeSet(
        principal,
        request.sourceSessionId,
      );
      if (cs)
        changeSet = {
          changeSetId: cs.changeSetId,
          workspaceId: cs.workspaceId,
        };
    }

    const planRef: ExecutionPlanReference = {
      planId: plan.planId,
      version: plan.version,
      executionPlanId: plan.id,
    };
    const verificationId = this.newId("vrf");
    const result: VerificationResult = {
      verificationId,
      projectId: request.projectId,
      plan: planRef,
      ...(request.sourceSessionId
        ? { sourceSessionId: request.sourceSessionId }
        : {}),
      ...(changeSet ? { changeSetId: changeSet.changeSetId } : {}),
      sourceFingerprint: "",
      toolchains: [],
      isolation: "none_ran",
      stages: planned.map((p) => ({
        stageRunId: this.newId("str"),
        stageId: p.stageId,
        stageKind: p.kind,
        ...(p.category ? { category: p.category } : {}),
        ...(profile?.stages[p.stageId]
          ? { operationId: profile.stages[p.stageId]!.operationId }
          : {}),
        required: profile?.stages[p.stageId]?.required ?? false,
        status: "not_run",
        attempts: 0,
        sessionIds: [],
        receiptIds: [],
        artifactIds: [],
      })),
      artifactIds: [],
      status: "pending",
      reasons: [],
      unverifiedStageIds: planned
        .filter((p) => !profile?.stages[p.stageId])
        .map((p) => p.stageId),
      requestedBy: principal.id,
      createdAt: this.clock(),
    };
    const state: RunState = {
      result,
      principal,
      activeSessions: new Set(),
      done: Promise.resolve(result),
    };
    this.runs.set(verificationId, state);
    this.byKey.set(key, verificationId);
    this.record("verification_requested", principal.id, request.projectId, {
      verification: verificationId,
      planId: plan.planId,
      planVersion: plan.version,
      ...(changeSet ? { changeSetId: changeSet.changeSetId } : {}),
    });
    state.done = this.run(state, planned, graph, profile, changeSet)
      .catch((error: unknown) =>
        this.finish(state, "failed", [
          {
            code: "EXECUTION_ERROR",
            detail:
              error instanceof Error ? error.message : "verification crashed",
          },
        ]),
      )
      .then(async (terminal) => {
        await this.persist(terminal);
        return terminal;
      });
    return result;
  }

  private validateStart(raw: unknown): StartVerificationRequest {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ValidationError("verification request must be an object");
    }
    const value = raw as Record<string, unknown>;
    for (const k of Object.keys(value)) {
      if (!START_KEYS.includes(k)) {
        throw new ValidationError(`unknown field ${k}`);
      }
    }
    const planVersion = value.planVersion;
    if (
      typeof planVersion !== "number" ||
      !Number.isInteger(planVersion) ||
      planVersion < 1
    ) {
      throw new ValidationError("planVersion must be a positive integer");
    }
    return {
      projectId: requireExecutionId(value.projectId, "projectId"),
      planId: requireExecutionId(value.planId, "planId"),
      planVersion,
      ...(value.sourceSessionId !== undefined
        ? {
            sourceSessionId: requireExecutionId(
              value.sourceSessionId,
              "sourceSessionId",
            ),
          }
        : {}),
    };
  }

  /**
   * Stage DAG: plan dependencies + profile `dependsOn`. Unknown references
   * and cycles are refused before anything runs. Returns a deterministic
   * topological order (plan order breaks ties).
   */
  private validateGraph(
    planned: readonly PlannedStage[],
    profile: VerificationProfile,
  ): { order: string[]; deps: Map<string, string[]> } {
    const ids = new Set(planned.map((p) => p.stageId));
    for (const stageId of Object.keys(profile.stages)) {
      if (!ids.has(stageId)) {
        throw new ValidationError(
          `profile stage ${stageId} is not in the plan revision`,
        );
      }
    }
    const deps = new Map<string, string[]>();
    for (const p of planned) {
      const all = [
        ...p.planDependsOn,
        ...(profile.stages[p.stageId]?.dependsOn ?? []),
      ];
      for (const d of all) {
        if (!ids.has(d)) {
          throw new ValidationError(
            `stage ${p.stageId} depends on unknown stage ${d}`,
          );
        }
      }
      deps.set(p.stageId, [...new Set(all)]);
    }
    const order: string[] = [];
    const mark = new Map<string, "visiting" | "done">();
    const visit = (id: string, path: string[]) => {
      if (mark.get(id) === "done") return;
      if (mark.get(id) === "visiting") {
        throw new ValidationError(
          `stage dependency cycle: ${[...path, id].join(" -> ")}`,
        );
      }
      mark.set(id, "visiting");
      for (const d of deps.get(id) ?? []) visit(d, [...path, id]);
      mark.set(id, "done");
      order.push(id);
    };
    for (const p of planned) visit(p.stageId, []);
    return { order, deps };
  }

  /* -------------------------------------------------------------- */
  /* Run                                                            */
  /* -------------------------------------------------------------- */

  private setStage(state: RunState, stageId: string, patch: Partial<StageRun>) {
    const r = state.result;
    state.result = {
      ...r,
      stages: r.stages.map((s) =>
        s.stageId === stageId ? { ...s, ...patch } : s,
      ),
    };
  }

  private stage(state: RunState, stageId: string): StageRun {
    return state.result.stages.find((s) => s.stageId === stageId)!;
  }

  private async run(
    state: RunState,
    planned: readonly PlannedStage[],
    graph: { order: readonly string[]; deps: Map<string, string[]> },
    profile: VerificationProfile | undefined,
    changeSet: { changeSetId: string; workspaceId: string } | undefined,
  ): Promise<VerificationResult> {
    const projectId = state.result.projectId;
    const { order, deps } = graph;
    state.result = { ...state.result, status: "running" };
    const control = this.options.workspaceControl;

    // Exact revision only: a superseded plan is never verified.
    const latest = this.options.planning.latest(state.result.plan.planId);
    if (!latest || latest.version !== state.result.plan.version) {
      return this.finish(state, "blocked", [
        { code: "STALE_PLAN", detail: "a newer plan revision exists" },
      ]);
    }
    if (!profile) {
      return this.finish(state, "blocked", [
        {
          code: "NO_PROFILE",
          detail: "no verification profile is configured for this project",
        },
      ]);
    }
    if (!control?.sourceFingerprint) {
      return this.finish(state, "blocked", [
        {
          code: "FINGERPRINT_UNAVAILABLE",
          detail: "the source state cannot be fingerprinted",
        },
      ]);
    }
    const initial = await control.sourceFingerprint(projectId);
    state.result = {
      ...state.result,
      sourceFingerprint: initial.fingerprint,
      ...(initial.baseRevision ? { baseRevision: initial.baseRevision } : {}),
    };
    if (changeSet)
      control.setChangeSetStatus?.(changeSet.workspaceId, "verifying");

    for (const p of planned) {
      if (!profile.stages[p.stageId]) {
        this.setStage(state, p.stageId, {
          failure: {
            kind: "NO_PROFILE",
            detail: "no registered operation is mapped to this planned stage",
          },
        });
      }
    }

    // ---- scheduler: bounded parallelism, write stages run exclusively ----
    const pending = order.filter((id) => profile.stages[id]);
    const running = new Map<string, Promise<void>>();
    let exclusive = false;
    let stopReason: StageFailureKind | undefined;
    const isWrite = (id: string) => {
      const op = this.options.operations.get(profile.stages[id]!.operationId);
      return op ? operationWorkspaceAccess(op) === "write" : true;
    };
    while (pending.length > 0 || running.size > 0) {
      if (state.cancelRequested) stopReason = "CANCELLED";
      let progressed = false;
      for (const id of [...pending]) {
        const blocking = (deps.get(id) ?? []).map((d) => this.stage(state, d));
        if (
          blocking.some(
            (s) => s.status === "running" || pending.includes(s.stageId),
          )
        ) {
          continue;
        }
        const failedDep = blocking.find((s) => s.status !== "passed");
        if (failedDep || stopReason) {
          pending.splice(pending.indexOf(id), 1);
          progressed = true;
          this.setStage(
            state,
            id,
            failedDep
              ? {
                  failure: {
                    kind: "BLOCKED_BY_DEPENDENCY",
                    detail: `dependency ${failedDep.stageId} did not pass`,
                  },
                }
              : stopReason === "CANCELLED"
                ? {
                    status: "cancelled",
                    failure: {
                      kind: "CANCELLED",
                      detail: "the verification was cancelled",
                    },
                  }
                : {
                    failure: {
                      kind: "FAIL_FAST",
                      detail: "not started: a required stage failed",
                    },
                  },
          );
          continue;
        }
        // Write stages hold the workspace exclusively; the order is kept.
        const write = isWrite(id);
        if (
          exclusive ||
          running.size >= profile.maxParallel ||
          (write && running.size > 0)
        ) {
          break;
        }
        pending.splice(pending.indexOf(id), 1);
        progressed = true;
        if (write) exclusive = true;
        const task = this.runStage(state, id, profile.stages[id]!, changeSet)
          .then(() => {
            const s = this.stage(state, id);
            if (s.required && s.status !== "passed" && profile.failFast) {
              stopReason ??= "FAIL_FAST";
            }
          })
          .finally(() => {
            running.delete(id);
            if (write) exclusive = false;
          });
        running.set(id, task);
        if (write) break;
      }
      if (running.size > 0) {
        await Promise.race(running.values());
      } else if (!progressed) {
        // Unreachable for a validated DAG; never spin.
        for (const id of pending.splice(0)) {
          this.setStage(state, id, {
            status: "error",
            failure: { kind: "EXECUTION_ERROR", detail: "unschedulable stage" },
          });
        }
      }
    }

    // ---- final fingerprint: evidence is for exactly one source state ----
    const final = await control
      .sourceFingerprint(projectId)
      .catch(() => undefined);
    state.result = {
      ...state.result,
      ...(final ? { finalFingerprint: final.fingerprint } : {}),
    };
    const reasons: VerificationReason[] = [];
    if (!final || final.fingerprint !== initial.fingerprint) {
      reasons.push({
        code: "SOURCE_CHANGED",
        detail: "the source changed while it was being verified",
      });
    }
    const status = this.overallStatus(state, profile, reasons);
    const finished = this.finish(state, status, reasons);
    if (changeSet) {
      control.setChangeSetStatus?.(
        changeSet.workspaceId,
        status === "passed" ? "verified" : "verification_failed",
      );
    }
    return finished;
  }

  private overallStatus(
    state: RunState,
    profile: VerificationProfile,
    reasons: VerificationReason[],
  ): VerificationStatus {
    if (state.cancelRequested) return "cancelled";
    if (reasons.some((r) => r.code === "SOURCE_CHANGED")) return "failed";
    const required = state.result.stages.filter((s) => s.required);
    if (required.some((s) => s.status === "failed" || s.status === "error")) {
      reasons.push({
        code: "REQUIRED_STAGE_FAILED",
        detail: "a required stage failed",
      });
      return "failed";
    }
    if (required.some((s) => s.status === "timed_out")) {
      reasons.push({ code: "TIMEOUT", detail: "a required stage timed out" });
      return "timed_out";
    }
    if (required.some((s) => s.status !== "passed")) {
      reasons.push({
        code: "REQUIRED_STAGE_BLOCKED",
        detail: "a required stage could not run",
      });
      return "blocked";
    }
    if (
      profile.requireAllPlannedStages &&
      state.result.unverifiedStageIds.length > 0
    ) {
      reasons.push({
        code: "UNVERIFIED_STAGES",
        detail: "planned stages have no verification profile",
      });
      return "blocked";
    }
    if (!state.result.stages.some((s) => s.status === "passed")) {
      reasons.push({ code: "NOTHING_VERIFIED", detail: "no stage ran" });
      return "blocked";
    }
    return "passed";
  }

  private finish(
    state: RunState,
    status: VerificationStatus,
    reasons: readonly VerificationReason[],
  ): VerificationResult {
    const result = deepFreeze({
      ...state.result,
      status,
      reasons: [...state.result.reasons, ...reasons],
      artifactIds: state.result.stages.flatMap((s) => s.artifactIds),
      completedAt: this.clock(),
    });
    state.result = result;
    this.record(
      "verification_completed",
      state.principal.id,
      result.projectId,
      {
        verification: result.verificationId,
        status,
        reasonCodes: result.reasons.map((r) => r.code),
        stages: result.stages.map((s) => `${s.stageId}:${s.status}`),
        sourceFingerprint: result.sourceFingerprint,
      },
    );
    return result;
  }

  private async runStage(
    state: RunState,
    stageId: string,
    stageProfile: StageProfile,
    changeSet: { changeSetId: string } | undefined,
  ): Promise<void> {
    const { principal } = state;
    const verificationId = state.result.verificationId;
    const op = this.options.operations.get(stageProfile.operationId)!;
    const maxAttempts = stageProfile.maxAttempts ?? 1;
    const startedAt = this.clock();
    this.setStage(state, stageId, { status: "running", startedAt });
    this.record("stage_started", principal.id, state.result.projectId, {
      verification: verificationId,
      stageId,
      operationId: op.id,
    });

    let patch: Partial<StageRun> = {};
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (state.cancelRequested) {
        patch = {
          status: "cancelled",
          failure: {
            kind: "CANCELLED",
            detail: "the verification was cancelled",
          },
        };
        break;
      }
      const ref = `${verificationId}:${stageId}:${attempt}`;
      const current = this.stage(state, stageId);
      let session;
      try {
        ({ session } = await this.options.manager.createSession(
          principal,
          {
            projectId: state.result.projectId,
            planId: state.result.plan.planId,
            planVersion: state.result.plan.version,
            stageId,
            operationId: op.id,
            ...(stageProfile.input ? { input: { ...stageProfile.input } } : {}),
          },
          ref,
        ));
      } catch (error) {
        patch = {
          attempts: attempt,
          status: "error",
          failure: {
            kind: "EXECUTION_ERROR",
            detail: error instanceof Error ? error.message : "session failed",
          },
        };
        break;
      }
      this.setStage(state, stageId, {
        attempts: attempt,
        sessionIds: [...current.sessionIds, session.sessionId],
      });
      this.observeEnvironment(
        state,
        session.environmentInstanceId,
        session.sandbox?.providerId,
      );
      if (session.status === "denied") {
        patch = {
          status: "blocked",
          failure: this.denialFailure(session.reasons),
        };
        break;
      }

      state.activeSessions.add(session.sessionId);
      let invocation: InvocationResult;
      try {
        invocation = await this.options.manager.invoke(principal, {
          sessionId: session.sessionId,
          invocationId: ref,
          toolId: op.toolId,
          operationId: op.id,
          ...(stageProfile.input ? { input: { ...stageProfile.input } } : {}),
        });
      } catch (error) {
        patch = {
          status: state.cancelRequested ? "cancelled" : "error",
          failure: state.cancelRequested
            ? { kind: "CANCELLED", detail: "the verification was cancelled" }
            : {
                kind: "EXECUTION_ERROR",
                detail:
                  error instanceof Error ? error.message : "invocation failed",
              },
        };
        break;
      } finally {
        state.activeSessions.delete(session.sessionId);
      }
      const latest = this.stage(state, stageId);
      this.setStage(state, stageId, {
        receiptIds: [...latest.receiptIds, invocation.receiptId],
        exitClass: invocation.exitClass,
        ...(invocation.output ? { log: this.excerpt(invocation.output) } : {}),
        ...(invocation.environment
          ? { environment: invocation.environment }
          : {}),
      });
      patch = this.classify(op, invocation);
      // EO-4.5 source handoff: a runner that executed a different source
      // state never counts as evidence for this verification.
      const ran = invocation.environment?.sourceFingerprint;
      if (ran && ran !== state.result.sourceFingerprint) {
        patch = {
          status: "failed",
          failure: {
            kind: "SOURCE_CHANGED",
            detail: `runner ${invocation.environment!.runnerId} executed a different source fingerprint`,
          },
        };
        break;
      }
      // Only TRANSIENT execution failures are retried; a failing build or
      // test is a result, not a reason to try again.
      const transient =
        invocation.exitClass === "sandbox_failure" ||
        invocation.exitClass === "resource_limit";
      if (!transient || state.cancelRequested) break;
    }

    if (patch.status === "passed" && stageProfile.artifacts?.length) {
      const artifactIds: string[] = [];
      try {
        for (const a of stageProfile.artifacts) {
          const record = await this.options.artifacts.record({
            projectId: state.result.projectId,
            verificationId,
            stageId,
            ...(changeSet ? { changeSetId: changeSet.changeSetId } : {}),
            sourceFingerprint: state.result.sourceFingerprint,
            kind: a.kind,
            path: a.path,
            ...(a.mediaType ? { mediaType: a.mediaType } : {}),
          });
          artifactIds.push(record.artifactId);
        }
        patch = { ...patch, artifactIds };
      } catch (error) {
        patch = {
          ...patch,
          artifactIds,
          status: "failed",
          failure: {
            kind: "EXECUTION_ERROR",
            detail: `artifact rejected: ${error instanceof Error ? error.message : "unknown"}`,
          },
        };
      }
    }
    const endedAt = this.clock();
    this.setStage(state, stageId, {
      ...patch,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    });
    const done = this.stage(state, stageId);
    this.record("stage_completed", principal.id, state.result.projectId, {
      verification: verificationId,
      stageId,
      status: done.status,
      attempts: done.attempts,
      ...(done.failure ? { failureKind: done.failure.kind } : {}),
    });
  }

  private classify(
    op: ExecutionOperationDefinition,
    invocation: InvocationResult,
  ): Partial<StageRun> {
    switch (invocation.exitClass) {
      case "success":
        return { status: "passed" };
      case "tool_failure": {
        if (op.stageKind === "security") {
          const findings = this.findings(invocation);
          return {
            status: "failed",
            failure: {
              kind: "FINDINGS",
              detail: "the security check reported findings",
            },
            ...(findings ? { findings } : {}),
          };
        }
        const invalid = invocation.reasons.find(
          (r) => r.code === "INVALID_OUTPUT",
        );
        return {
          status: "failed",
          failure: {
            kind: op.stageKind === "test" ? "TEST_FAILED" : "BUILD_FAILED",
            detail: invalid?.detail ?? "the process exited unsuccessfully",
          },
        };
      }
      case "timeout":
        return {
          status: "timed_out",
          failure: {
            kind: "TIMEOUT",
            detail: "the stage exceeded its timeout",
          },
        };
      case "cancelled":
        return {
          status: "cancelled",
          failure: { kind: "CANCELLED", detail: "the stage was cancelled" },
        };
      case "denied":
        return {
          status: "blocked",
          failure: this.denialFailure(invocation.reasons),
        };
      default:
        return {
          status: "error",
          failure: {
            kind: "EXECUTION_ERROR",
            detail:
              invocation.reasons[0]?.detail ?? "the sandbox reported a failure",
          },
        };
    }
  }

  private denialFailure(
    reasons: readonly ExecutionReason[],
  ): StageRun["failure"] {
    for (const kind of DENIAL_KINDS) {
      const reason = reasons.find((r) => r.code === kind);
      if (reason) return { kind, detail: reason.detail };
    }
    return {
      kind: "POLICY_DENIED",
      detail:
        reasons.map((r) => `${r.code}: ${r.detail}`).join("; ") ||
        "execution was denied",
    };
  }

  /** Secret-scan evidence: rule + count only (paths stay in the log). */
  private findings(
    invocation: InvocationResult,
  ): SecurityFindingSummary[] | undefined {
    try {
      const parsed = JSON.parse(invocation.output?.text ?? "") as {
        findings?: { rule?: unknown }[];
      };
      const counts = new Map<string, number>();
      for (const f of parsed.findings ?? []) {
        if (typeof f.rule === "string")
          counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
      }
      return [...counts].map(([rule, count]) => ({
        rule,
        severity: "high" as const,
        count,
      }));
    } catch {
      return undefined;
    }
  }

  private excerpt(output: { text: string; truncated: boolean }) {
    const max = this.options.maxLogBytes ?? 16 * 1024;
    const bytes = Buffer.from(output.text, "utf8");
    return bytes.length > max
      ? { text: bytes.subarray(0, max).toString("utf8"), truncated: true }
      : { text: output.text, truncated: output.truncated };
  }

  /** Toolchains + isolation as reported by registries — never assumed. */
  private observeEnvironment(
    state: RunState,
    environmentInstanceId: string,
    providerId: string | undefined,
  ): void {
    let next = state.result;
    if (!next.environmentInstanceId && environmentInstanceId) {
      const instance = this.options.environments.getInstance(
        environmentInstanceId,
      );
      const toolchains: ToolchainObservation[] = (
        instance?.toolchains ?? []
      ).map((t) => ({
        kind: t.kind,
        name: t.name,
        ...(t.version
          ? {
              version: `${t.version.major}.${t.version.minor}.${t.version.patch}`,
            }
          : {}),
        source: "environment_registry" as const,
      }));
      next = { ...next, environmentInstanceId, toolchains };
    }
    const provider = providerId
      ? this.options.sandboxes.get(providerId)
      : undefined;
    if (provider) {
      const seen = {
        filesystem: provider.capabilities.filesystemIsolation,
        network: provider.capabilities.networkIsolation,
      };
      // The verification is only as isolated as its least isolated stage.
      const prev = next.isolation;
      next = {
        ...next,
        isolation:
          prev === "none_ran"
            ? seen
            : {
                filesystem: prev.filesystem && seen.filesystem,
                network: prev.network && seen.network,
              },
      };
    }
    state.result = next;
  }

  /* -------------------------------------------------------------- */
  /* Cancel / read                                                  */
  /* -------------------------------------------------------------- */

  async cancel(
    principal: OperatorPrincipal,
    verificationId: string,
    reason: string,
  ): Promise<VerificationResult> {
    const state = this.scoped(principal, verificationId, "cancel_execution");
    if (
      typeof reason !== "string" ||
      reason.trim() === "" ||
      reason.length > 500
    ) {
      throw new ValidationError("a reason (1-500 characters) is required");
    }
    if (state.result.completedAt) return state.result;
    state.cancelRequested ??= { by: principal.id, reason };
    this.record(
      "verification_cancel_requested",
      principal.id,
      state.result.projectId,
      {
        verification: verificationId,
      },
    );
    await Promise.all(
      [...state.activeSessions].map((id) =>
        this.options.manager
          .cancel(principal, id, reason, "cancel")
          .catch(() => undefined),
      ),
    );
    return state.result;
  }

  get(
    principal: OperatorPrincipal,
    verificationId: string,
  ): VerificationResult {
    return this.scoped(principal, verificationId, "view").result;
  }

  /** Resolves with the terminal, immutable result. */
  async wait(
    principal: OperatorPrincipal,
    verificationId: string,
  ): Promise<VerificationResult> {
    return this.scoped(principal, verificationId, "view").done;
  }

  private async persist(result: VerificationResult): Promise<void> {
    if (!this.options.store) return;
    try {
      await this.options.store.create(
        result.verificationId,
        {
          projectId: result.projectId,
          kind: "verification",
          createdAt: result.createdAt,
        },
        result,
      );
    } catch {
      this.record(
        "verification_persistence_failed",
        result.requestedBy,
        result.projectId,
        {
          verification: result.verificationId,
        },
      );
    }
  }

  /**
   * A verification by id — live runs first, then durable history (EO-4.8),
   * so evidence from before a restart still backs commits and releases.
   */
  async load(
    principal: OperatorPrincipal,
    verificationId: string,
  ): Promise<VerificationResult> {
    const id = requireExecutionId(verificationId, "verificationId");
    if (this.runs.has(id)) return this.get(principal, id);
    const stored = await this.options.store?.get<VerificationResult>(id);
    if (!stored) throw new NotFoundError("resource not found");
    this.authorize(principal, stored.projectId, "view");
    return deepFreeze(stored);
  }

  /** Live + durable history for one project, newest first, bounded. */
  async listHistory(
    principal: OperatorPrincipal,
    projectId: string,
    limit = 50,
  ): Promise<VerificationResult[]> {
    const live = this.history(principal, projectId);
    const stored = this.options.store
      ? await this.options.store.listBy<VerificationResult>(
          "projectId",
          projectId,
          { kind: "verification", limit },
        )
      : [];
    const seen = new Set(live.map((r) => r.verificationId));
    return [...live, ...stored.filter((r) => !seen.has(r.verificationId))]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(Math.max(1, limit), 200));
  }

  /** Immutable history for one project, newest first. */
  history(
    principal: OperatorPrincipal,
    projectId: string,
  ): VerificationResult[] {
    this.authorize(
      principal,
      requireExecutionId(projectId, "projectId"),
      "view",
    );
    return [...this.runs.values()]
      .map((r) => r.result)
      .filter((r) => r.projectId === projectId)
      .reverse();
  }

  private scoped(
    principal: OperatorPrincipal,
    verificationId: string,
    capability: "view" | "cancel_execution",
  ): RunState {
    const state = this.runs.get(
      requireExecutionId(verificationId, "verificationId"),
    );
    if (!state) throw new NotFoundError("resource not found");
    this.authorize(principal, state.result.projectId, capability);
    return state;
  }
}
