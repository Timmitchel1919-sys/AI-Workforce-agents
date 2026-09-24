/**
 * ExecutionManager — EO-4.1 coordinator of the execution CONTROL BOUNDARY.
 *
 *   authorize → load exact plan revision → stage → operation/tool → input &
 *   workspace paths → agent revalidation → environment revalidation →
 *   policy (deny by default) → approval revalidation → sandbox + limits
 *   → pre-flight result → (optionally) session + scoped capability grants
 *
 * It prepares and governs; it NEVER executes. There is no method that runs a
 * tool, a process or a command, and no path from a request string to an
 * executable. AUTHENTICATED ≠ AUTHORIZED ≠ APPROVED ≠ EXECUTION-CAPABLE: each
 * is its own gate below.
 */
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  ExecutionDeniedError,
  operatorCan,
  operatorCanAccessProject,
  requireExecutionId,
  validateExecutionRequest,
  type Agent,
  type CapabilityGrant,
  type ExecutionOperationDefinition,
  type ExecutionPlan,
  type ExecutionPlanReference,
  type ExecutionReason,
  type ExecutionRequest,
  type ExecutionSession,
  type ExecutionStageKind,
  type ExecutionWorkspace,
  type OperatorPrincipal,
  type PreflightCheck,
  type PreflightResult,
  type SandboxProvider,
} from "../../contracts/index.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import { AgentQualificationRouter } from "../environments/agent-qualification-router.js";
import type { EnvironmentRegistry } from "../environments/environment-registry.js";
import { EnvironmentRouter } from "../environments/environment-router.js";
import {
  EXECUTION_PLAN_APPROVAL_ACTION,
  type ExecutionPlanningService,
} from "../planning/execution-planning-service.js";
import { createId, now } from "../shared.js";
import { agentAllowed, projectAllowed } from "../tools/tool-policy.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import {
  evaluatePolicy,
  type ExecutionPolicyRegistry,
  type PolicyEvaluation,
} from "./execution-policy.js";
import {
  validateOperationInput,
  type ExecutionOperationRegistry,
} from "./execution-operations.js";
import {
  planCancellation,
  transitionSession,
  type CancelOutcome,
  type ExecutionSessionStore,
} from "./execution-sessions.js";
import { limitEnforcementFor, type SandboxRegistry } from "./sandbox.js";

export interface ExecutionManagerOptions {
  planning: Pick<ExecutionPlanningService, "get" | "latest" | "refreshSeries">;
  approvals: Pick<ApprovalSystem, "get">;
  agents: { get(id: string): Agent | undefined };
  isAgentEnabled?: (agentId: string) => boolean;
  environments: EnvironmentRegistry;
  tools: Pick<ToolRegistry, "get">;
  projects: { has(projectId: string): boolean };
  operations: ExecutionOperationRegistry;
  policies: ExecutionPolicyRegistry;
  sandboxes: SandboxRegistry;
  sessions: ExecutionSessionStore;
  audit: AuditLog;
  clock?: () => string;
  idFactory?: (prefix: string) => string;
}

interface StageInfo {
  kind: ExecutionStageKind;
  componentIds: readonly string[];
  environmentRequirementId?: string;
  agentRequirementId?: string;
}

type Checks = Record<PreflightCheck, "pass" | "fail" | "skipped">;

function freshChecks(): Checks {
  return {
    authorization: "skipped",
    plan: "skipped",
    stage: "skipped",
    approval: "skipped",
    policy: "skipped",
    agent: "skipped",
    environment: "skipped",
    tool: "skipped",
    input: "skipped",
    workspace: "skipped",
    sandbox: "skipped",
  };
}

export class ExecutionManager {
  private readonly clock: () => string;
  private readonly newId: (prefix: string) => string;
  private readonly router: EnvironmentRouter;
  private readonly qualification: AgentQualificationRouter;

  constructor(private readonly options: ExecutionManagerOptions) {
    this.clock = options.clock ?? now;
    this.newId = options.idFactory ?? createId;
    this.router = new EnvironmentRouter(options.environments);
    this.qualification = new AgentQualificationRouter(options.environments);
  }

  /* -------------------------------------------------------------- */
  /* Pre-flight (no side effects besides an audit record)          */
  /* -------------------------------------------------------------- */

  /**
   * Evaluate every gate for one plan stage. Returns ELIGIBLE or DENIED with
   * reason codes — never executes. Throws only for authorization (403) and
   * for resources the caller may not see or that do not exist (404, no
   * existence leak).
   */
  async preflight(
    principal: OperatorPrincipal,
    rawRequest: unknown,
  ): Promise<PreflightResult> {
    const request = validateExecutionRequest(rawRequest);
    const evaluated = await this.evaluate(
      principal,
      request,
      "prepare_execution",
    );
    // The internal grant context never leaves the manager.
    const result: PreflightResult & { internal?: InternalContext } = {
      ...evaluated,
    };
    delete result.internal;
    this.record("preflight", principal.id, request.projectId, {
      decision: result.decision,
      reasonCodes: result.reasons.map((r) => r.code),
      executionPlanId: result.plan.executionPlanId,
      stageId: request.stageId,
      ...(result.operationId ? { operationId: result.operationId } : {}),
      ...(result.policy
        ? {
            policyId: result.policy.policyId,
            policyVersion: result.policy.version,
          }
        : {}),
    });
    return result;
  }

  private authorize(
    principal: OperatorPrincipal,
    projectId: string,
    capability:
      "prepare_execution" | "view" | "cancel_execution" | "kill_execution",
  ): void {
    if (!operatorCan(principal, capability)) {
      throw new PermissionDeniedError(
        `operator ${principal.id} lacks the ${capability} capability`,
      );
    }
    // Invisible and nonexistent projects look identical (no enumeration).
    if (
      !operatorCanAccessProject(principal, projectId) ||
      !this.options.projects.has(projectId)
    ) {
      throw new NotFoundError("resource not found");
    }
  }

  private async evaluate(
    principal: OperatorPrincipal,
    request: ExecutionRequest,
    capability: "prepare_execution",
  ): Promise<PreflightResult & { internal?: InternalContext }> {
    const checks = freshChecks();
    const reasons: ExecutionReason[] = [];
    const fail = (check: PreflightCheck, reason: ExecutionReason) => {
      checks[check] = "fail";
      reasons.push(reason);
    };
    const pass = (check: PreflightCheck) => {
      if (checks[check] !== "fail") checks[check] = "pass";
    };

    // 1. Authorization (AUTHENTICATED is the HTTP layer; this is AUTHORIZED).
    this.authorize(principal, request.projectId, capability);
    pass("authorization");

    // 2. Exact plan revision — never "the newest".
    const planRef: ExecutionPlanReference = {
      planId: request.planId,
      version: request.planVersion,
      executionPlanId: `${request.planId}@v${request.planVersion}`,
    };
    await this.options.planning.refreshSeries(request.planId);
    const plan = this.options.planning.get(planRef.executionPlanId);
    if (!plan || plan.projectId !== request.projectId) {
      throw new NotFoundError("resource not found");
    }
    const latest = this.options.planning.latest(request.planId);
    if (
      plan.status === "superseded" ||
      (latest && latest.version !== plan.version)
    ) {
      fail("plan", {
        code: "STALE_PLAN",
        detail: `plan revision v${plan.version} is superseded${latest ? ` by v${latest.version}` : ""}`,
      });
    } else if (plan.status === "blocked" || plan.status === "draft") {
      fail("plan", {
        code: "PLAN_NOT_EXECUTABLE",
        detail: `plan revision is ${plan.status}${plan.blockers.length ? `: ${[...new Set(plan.blockers.map((b) => b.code))].join(", ")}` : ""}`,
      });
    }
    pass("plan");

    const base = {
      plan: planRef,
      projectId: request.projectId,
      stageId: request.stageId,
      executionAvailable: false as const,
    };

    // 3. Stage.
    const stage = stageOf(plan, request.stageId);
    if (!stage) {
      fail("stage", {
        code: "PLAN_NOT_EXECUTABLE",
        detail: "the plan revision has no such stage",
      });
      return {
        ...base,
        decision: "DENIED",
        reasons,
        checks,
        requiredCapabilities: [],
        requiredApprovals: [],
      };
    }
    pass("stage");

    // 4. Operation + tool (registered only; unknown → deny, never resolved).
    const operation = this.resolveOperation(request, stage.kind, fail);
    const tool = operation
      ? this.options.tools.get(operation.toolId)
      : undefined;
    if (operation && !tool) {
      fail("tool", {
        code: "TOOL_NOT_ALLOWED",
        detail: `tool ${operation.toolId} is not registered`,
      });
    } else if (tool && !projectAllowed(tool, request.projectId)) {
      fail("tool", {
        code: "TOOL_NOT_ALLOWED",
        detail: "the tool is not allowed for this project",
      });
    }

    // 5. Structured input + workspace paths.
    if (operation) {
      try {
        validateOperationInput(operation, request.input);
        pass("input");
        pass("workspace");
      } catch (error) {
        if (error instanceof ExecutionDeniedError) {
          fail(error.code === "WORKSPACE_VIOLATION" ? "workspace" : "input", {
            code: error.code,
            detail: error.message,
          });
        } else {
          throw error;
        }
      }
    }

    // 6. Agent revalidation (not the planning snapshot).
    const agentId = this.revalidateAgent(plan, stage, fail);
    if (agentId) {
      pass("agent");
      if (tool && !agentAllowed(tool, agentId)) {
        fail("tool", {
          code: "TOOL_NOT_ALLOWED",
          detail: "the tool is not allowed for the assigned agent",
        });
      }
    }
    if (tool) pass("tool");

    // 7. Policy (deny by default).
    const policy = this.options.policies.forProject(request.projectId);
    let evaluation: PolicyEvaluation | undefined;
    if (!policy) {
      fail("policy", {
        code: "POLICY_DENIED",
        detail: "no execution policy governs this project",
      });
    } else if (operation) {
      evaluation = evaluatePolicy(policy, operation);
      evaluation.reasons.forEach((r) => fail("policy", r));
      pass("policy");
    }

    // 8. Environment revalidation (not the planning snapshot).
    const environmentInstanceId = this.revalidateEnvironment(
      plan,
      stage,
      evaluation?.rule?.requiredEnvironmentCapabilities ?? [],
      fail,
    );
    if (environmentInstanceId) pass("environment");

    // 9. Approval revalidation against the authoritative approval record.
    const requiredApprovals = this.revalidateApprovals(
      plan,
      stage,
      request,
      evaluation,
      fail,
    );
    if (checks.approval !== "fail") checks.approval = "pass";

    // 10. Sandbox + limits (provider availability is never faked).
    let sandbox: SandboxProvider | undefined;
    if (environmentInstanceId && evaluation) {
      sandbox = this.options.sandboxes.select(
        environmentInstanceId,
        evaluation.network,
      );
      if (!sandbox) {
        fail("sandbox", {
          code: "SANDBOX_UNAVAILABLE",
          detail: "no sandbox provider can isolate and bound this execution",
        });
      } else {
        pass("sandbox");
      }
    }

    const decision = reasons.length === 0 ? "ELIGIBLE" : "DENIED";
    return {
      ...base,
      decision,
      reasons,
      checks,
      stageKind: stage.kind,
      ...(operation
        ? {
            operationId: operation.id,
            toolId: operation.toolId,
            risk: operation.risk,
          }
        : {}),
      ...(agentId ? { agentId } : {}),
      ...(environmentInstanceId ? { environmentInstanceId } : {}),
      ...(policy
        ? { policy: { policyId: policy.policyId, version: policy.version } }
        : {}),
      requiredCapabilities: operation
        ? [...operation.requiredCapabilities]
        : [],
      requiredApprovals,
      ...(evaluation
        ? {
            limits: evaluation.limits,
            limitEnforcement: limitEnforcementFor(sandbox, evaluation.limits),
            network: evaluation.network,
          }
        : {}),
      ...(sandbox
        ? { sandbox: { providerId: sandbox.providerId, kind: sandbox.kind } }
        : {}),
      ...(decision === "ELIGIBLE" &&
      operation &&
      evaluation &&
      agentId &&
      environmentInstanceId &&
      policy
        ? {
            internal: {
              operation,
              evaluation,
              agentId,
              environmentInstanceId,
              policy: {
                policyId: policy.policyId,
                version: policy.version,
                grantTtlMs: policy.grantTtlMs,
              },
              approvalIds: requiredApprovals.flatMap((a) =>
                a.approvalId ? [a.approvalId] : [],
              ),
            },
          }
        : {}),
    };
  }

  private resolveOperation(
    request: ExecutionRequest,
    kind: ExecutionStageKind,
    fail: (c: PreflightCheck, r: ExecutionReason) => void,
  ): ExecutionOperationDefinition | undefined {
    if (request.operationId !== undefined) {
      const op = this.options.operations.get(request.operationId);
      if (!op) {
        fail("tool", {
          code: "TOOL_NOT_ALLOWED",
          detail: "unknown operation (not registered)",
        });
        return undefined;
      }
      if (op.stageKind !== kind) {
        fail("tool", {
          code: "TOOL_NOT_ALLOWED",
          detail: `operation is not valid for a ${kind} stage`,
        });
        return undefined;
      }
      return op;
    }
    const candidates = this.options.operations.forStageKind(kind);
    if (candidates.length === 1) return candidates[0];
    fail("tool", {
      code: "TOOL_NOT_ALLOWED",
      detail:
        candidates.length === 0
          ? `no execution operation is registered for ${kind} stages`
          : "several operations match this stage; operationId is required",
    });
    return undefined;
  }

  private revalidateAgent(
    plan: ExecutionPlan,
    stage: StageInfo,
    fail: (c: PreflightCheck, r: ExecutionReason) => void,
  ): string | undefined {
    const requirement = stage.agentRequirementId
      ? plan.agentRequirements.find((r) => r.id === stage.agentRequirementId)
      : undefined;
    if (!requirement) {
      fail("agent", {
        code: "AGENT_NOT_QUALIFIED",
        detail: `no agent requirement is planned for this ${stage.kind} stage`,
      });
      return undefined;
    }
    const assignment = plan.agents.find(
      (a) => a.requirementId === requirement.id,
    );
    if (!assignment?.agentId) {
      fail("agent", {
        code: "AGENT_NOT_QUALIFIED",
        detail: "the plan assigned no qualified agent",
      });
      return undefined;
    }
    const agent = this.options.agents.get(assignment.agentId);
    if (!agent) {
      fail("agent", {
        code: "AGENT_NOT_QUALIFIED",
        detail: "the assigned agent is no longer registered",
      });
      return undefined;
    }
    const [evidence] = this.qualification.evaluateCandidates(
      [agent],
      {
        projectId: plan.projectId,
        requiredCapabilities: requirement.requiredCapabilities,
      },
      this.options.isAgentEnabled ?? (() => true),
    );
    if (!evidence?.qualifies) {
      fail("agent", {
        code: "AGENT_NOT_QUALIFIED",
        detail: `the assigned agent no longer qualifies: ${(evidence?.reasonCodes ?? []).join(", ")}`,
      });
      return undefined;
    }
    return agent.id;
  }

  private revalidateEnvironment(
    plan: ExecutionPlan,
    stage: StageInfo,
    requiredCapabilities: readonly string[],
    fail: (c: PreflightCheck, r: ExecutionReason) => void,
  ): string | undefined {
    const planned = stage.environmentRequirementId
      ? plan.environments.find((e) => e.id === stage.environmentRequirementId)
      : undefined;
    const instanceId = planned?.match.selectedInstanceId;
    if (!planned || !instanceId) {
      fail("environment", {
        code: "ENVIRONMENT_UNAVAILABLE",
        detail: "the plan selected no environment for this stage",
      });
      return undefined;
    }
    const instance = this.options.environments.getInstance(instanceId);
    const host = instance
      ? this.options.environments.getHost(instance.hostId)
      : undefined;
    if (!instance || !host) {
      fail("environment", {
        code: "ENVIRONMENT_UNAVAILABLE",
        detail: "the selected environment is no longer registered",
      });
      return undefined;
    }
    if (
      instance.availability !== "available" ||
      host.availability !== "available"
    ) {
      fail("environment", {
        code: "ENVIRONMENT_UNAVAILABLE",
        detail: "the selected environment or its host is not available",
      });
      return undefined;
    }
    let eligible = false;
    let reasonCodes: readonly string[] = [];
    try {
      const evidence = this.router.evaluate(planned.requirement);
      const candidate = evidence.candidates.find(
        (c) => c.instanceId === instanceId,
      );
      eligible = candidate?.eligible ?? false;
      reasonCodes = candidate?.reasonCodes ?? ["not_evaluated"];
    } catch {
      reasonCodes = ["requirement_unresolvable"];
    }
    if (!eligible) {
      fail("environment", {
        code: "ENVIRONMENT_UNAVAILABLE",
        detail: `the selected environment is no longer eligible: ${reasonCodes.join(", ")}`,
      });
      return undefined;
    }
    const missing = requiredCapabilities.filter(
      (c) =>
        !instance.capabilities.some((d) => d.capability === c && d.available),
    );
    if (missing.length > 0) {
      fail("environment", {
        code: "ENVIRONMENT_UNAVAILABLE",
        detail: `the environment lacks policy-required capabilities: ${missing.join(", ")}`,
      });
      return undefined;
    }
    return instance.id;
  }

  private revalidateApprovals(
    plan: ExecutionPlan,
    stage: StageInfo,
    request: ExecutionRequest,
    evaluation: PolicyEvaluation | undefined,
    fail: (c: PreflightCheck, r: ExecutionReason) => void,
  ): PreflightResult["requiredApprovals"] {
    const needed: string[] = plan.approvalRequirements
      .filter((r) => r.subjectIds.includes(request.stageId))
      .map((r) => r.reason);
    if (evaluation?.requiresApproval) needed.push("operation_risk");
    if (needed.length === 0) return [];

    const approvalId = plan.approval.approvalId;
    const approval = approvalId
      ? this.options.approvals.get(approvalId)
      : undefined;
    const meta = approval?.decisionMetadata ?? {};
    const valid =
      plan.approval.state === "approved" &&
      approval !== undefined &&
      approval.status === "approved" &&
      approval.action === EXECUTION_PLAN_APPROVAL_ACTION &&
      meta.executionPlanId === plan.id &&
      meta.projectId === plan.projectId &&
      meta.planVersion === plan.version &&
      (!approval.expiresAt ||
        Date.parse(approval.expiresAt) > Date.parse(this.clock()));
    const state = valid
      ? "approved"
      : (approval?.status ?? plan.approval.state);
    if (!valid) {
      fail("approval", {
        code: "APPROVAL_REQUIRED",
        detail: `an approved approval for this exact plan revision is required (${needed.join(", ")})`,
      });
    }
    return needed.map((reason) => ({
      reason,
      ...(approvalId ? { approvalId } : {}),
      state,
    }));
  }

  /* -------------------------------------------------------------- */
  /* Sessions                                                      */
  /* -------------------------------------------------------------- */

  /**
   * Create a governed session from a pre-flight. Idempotent per
   * `(operator, idempotencyKey)`: a retry returns the same session; reusing a
   * key for a different request is refused. A DENIED pre-flight produces a
   * terminal `denied` session (evidence) with no grants. Nothing runs.
   */
  async createSession(
    principal: OperatorPrincipal,
    rawRequest: unknown,
    idempotencyKey: string,
  ): Promise<{ session: ExecutionSession; replayed: boolean }> {
    const key = requireExecutionId(idempotencyKey, "idempotencyKey");
    const request = validateExecutionRequest(rawRequest);
    const existing = await this.options.sessions.findByIdempotencyKey(
      principal.id,
      key,
    );
    if (existing) {
      if (
        existing.projectId !== request.projectId ||
        !sameRequest(existing, request)
      ) {
        throw new StateTransitionError(
          "idempotency key was already used for a different request",
        );
      }
      return { session: existing, replayed: true };
    }

    const evaluated = await this.evaluate(
      principal,
      request,
      "prepare_execution",
    );
    const at = this.clock();
    const sessionId = this.newId("exs");
    const workspaceId = this.newId("ews");
    const internal = evaluated.internal;
    const rule = internal?.evaluation.rule;
    const workspace: ExecutionWorkspace = {
      workspaceId,
      sessionId,
      projectId: request.projectId,
      rootRef: `workspace://${request.projectId}/${workspaceId}`,
      mode: rule?.filesystem.some((f) => f.access === "write")
        ? "read_write"
        : "read_only",
      status: internal ? "requested" : "released",
    };
    const grants: CapabilityGrant[] = internal
      ? internal.evaluation.capabilities.map((capability) => ({
          grantId: this.newId("grt"),
          sessionId,
          projectId: request.projectId,
          agentId: internal.agentId,
          environmentInstanceId: internal.environmentInstanceId,
          workspaceId,
          toolId: internal.operation.toolId,
          operationId: internal.operation.id,
          capability,
          ...(capability.startsWith("filesystem.")
            ? { filesystem: internal.evaluation.filesystem }
            : {}),
          ...(capability === "network.outbound.allowed-host"
            ? { network: internal.evaluation.network }
            : {}),
          policyId: internal.policy.policyId,
          policyVersion: internal.policy.version,
          issuedAt: at,
          expiresAt: new Date(
            Date.parse(at) + internal.policy.grantTtlMs,
          ).toISOString(),
        }))
      : [];

    let session: ExecutionSession = {
      sessionId,
      projectId: request.projectId,
      plan: evaluated.plan,
      stageId: request.stageId,
      stageKind: evaluated.stageKind ?? "build",
      operationId: evaluated.operationId ?? "",
      toolId: evaluated.toolId ?? "",
      agentId: evaluated.agentId ?? "",
      environmentInstanceId: evaluated.environmentInstanceId ?? "",
      policy: evaluated.policy ?? { policyId: "", version: 0 },
      approvalIds: internal?.approvalIds ?? [],
      risk: evaluated.risk ?? "critical",
      workspace,
      grants,
      limits: evaluated.limits ?? {
        sessionTimeoutMs: 1,
        operationTimeoutMs: 1,
        maxOutputBytes: 1,
        maxArtifactBytes: 1,
        maxToolCalls: 1,
      },
      limitEnforcement: evaluated.limitEnforcement ?? {},
      network: evaluated.network ?? { mode: "deny_all" },
      ...(evaluated.sandbox ? { sandbox: evaluated.sandbox } : {}),
      status: "created",
      reasons: [],
      requestedBy: principal.id,
      idempotencyKey: key,
      attempts: [],
      createdAt: at,
      revision: 1,
    };
    session = transitionSession(session, "validating", at);
    session =
      evaluated.decision === "ELIGIBLE"
        ? transitionSession(session, "ready", at)
        : transitionSession(session, "denied", at, {
            reasons: evaluated.reasons,
          });
    if ((await this.options.sessions.commit(session)) === "conflict") {
      const winner = await this.options.sessions.findByIdempotencyKey(
        principal.id,
        key,
      );
      if (winner && sameRequest(winner, request))
        return { session: winner, replayed: true };
      throw new StateTransitionError(
        "execution session could not be created (conflict)",
      );
    }
    this.record("session_created", principal.id, request.projectId, {
      execution: sessionId,
      status: session.status,
      reasonCodes: session.reasons.map((r) => r.code),
      executionPlanId: evaluated.plan.executionPlanId,
      stageId: request.stageId,
      grants: grants.map((g) => g.capability),
    });
    return { session, replayed: false };
  }

  /** Registered operations (safe metadata). Requires `view`. */
  listOperations(principal: OperatorPrincipal): ExecutionOperationDefinition[] {
    if (!operatorCan(principal, "view")) {
      throw new PermissionDeniedError(
        `operator ${principal.id} lacks the view capability`,
      );
    }
    return this.options.operations.list();
  }

  /** Session metadata, scoped: invisible and unknown sessions are both 404. */
  async getSession(
    principal: OperatorPrincipal,
    sessionId: string,
  ): Promise<ExecutionSession> {
    const session = await this.options.sessions.get(
      requireExecutionId(sessionId, "sessionId"),
    );
    if (!session) throw new NotFoundError("resource not found");
    this.authorize(principal, session.projectId, "view");
    return session;
  }

  async listSessions(
    principal: OperatorPrincipal,
    projectId: string,
  ): Promise<ExecutionSession[]> {
    this.authorize(
      principal,
      requireExecutionId(projectId, "projectId"),
      "view",
    );
    return this.options.sessions.listByProject(projectId);
  }

  /**
   * Cancel (operators) or kill (administrators — the emergency switch for ONE
   * session). Idempotent, state-aware and always audited. Agents have no path
   * to this: it is a Control Plane operation authorized by operator role.
   */
  async cancel(
    principal: OperatorPrincipal,
    sessionId: string,
    reason: string,
    kind: "cancel" | "kill",
  ): Promise<{ outcome: CancelOutcome; session: ExecutionSession }> {
    if (
      typeof reason !== "string" ||
      reason.trim().length === 0 ||
      reason.length > 500
    ) {
      throw new ValidationError("a reason (1-500 characters) is required");
    }
    const current = await this.options.sessions.get(
      requireExecutionId(sessionId, "sessionId"),
    );
    if (!current) throw new NotFoundError("resource not found");
    // Scope first (404 for invisible sessions), then capability (403).
    if (
      !operatorCanAccessProject(principal, current.projectId) ||
      !this.options.projects.has(current.projectId)
    ) {
      throw new NotFoundError("resource not found");
    }
    this.authorize(
      principal,
      current.projectId,
      kind === "kill" ? "kill_execution" : "cancel_execution",
    );

    for (let tries = 0; tries < 3; tries += 1) {
      const session =
        tries === 0 ? current : await this.options.sessions.get(sessionId);
      if (!session) throw new NotFoundError("resource not found");
      const planned = planCancellation(session, {
        by: principal.id,
        at: this.clock(),
        reason: reason.trim(),
        kind,
      });
      if (planned.session === session) {
        this.record(
          kind === "kill" ? "kill_requested" : "cancel_requested",
          principal.id,
          session.projectId,
          {
            execution: session.sessionId,
            outcome: planned.outcome,
            status: session.status,
          },
        );
        return planned;
      }
      if (
        (await this.options.sessions.commit(
          planned.session,
          session.revision,
        )) === "committed"
      ) {
        this.record(
          kind === "kill" ? "kill_requested" : "cancel_requested",
          principal.id,
          session.projectId,
          {
            execution: session.sessionId,
            outcome: planned.outcome,
            fromStatus: session.status,
            status: planned.session.status,
          },
        );
        return planned;
      }
    }
    throw new StateTransitionError(
      "execution session changed concurrently; retry",
    );
  }

  private record(
    action: string,
    actor: string,
    projectId: string,
    data: Record<string, unknown>,
  ): void {
    this.options.audit.record("execution_event", {
      projectId,
      data: { action, actor, ...data },
    });
  }
}

interface InternalContext {
  operation: ExecutionOperationDefinition;
  evaluation: PolicyEvaluation;
  agentId: string;
  environmentInstanceId: string;
  policy: { policyId: string; version: number; grantTtlMs: number };
  approvalIds: string[];
}

function sameRequest(
  session: ExecutionSession,
  request: ExecutionRequest,
): boolean {
  return (
    session.projectId === request.projectId &&
    session.plan.planId === request.planId &&
    session.plan.version === request.planVersion &&
    session.stageId === request.stageId &&
    (request.operationId === undefined ||
      session.operationId === request.operationId)
  );
}

/** Locate a stage in a plan revision and derive its agent/environment links. */
function stageOf(plan: ExecutionPlan, stageId: string): StageInfo | undefined {
  const requirementFor = (purpose: string, componentIds: readonly string[]) =>
    plan.agentRequirements.find(
      (r) =>
        r.purpose === purpose &&
        componentIds.some((c) => r.componentIds.includes(c)),
    )?.id;
  const build = plan.build.find((s) => s.id === stageId);
  if (build) {
    return {
      kind: "build",
      componentIds: [build.componentId],
      environmentRequirementId: build.environmentRequirementId,
      agentRequirementId: build.agentRequirementId,
    };
  }
  const test = plan.tests.find((s) => s.id === stageId);
  if (test) {
    return {
      kind: "test",
      componentIds: [test.componentId],
      environmentRequirementId: test.environmentRequirementId,
      // A dedicated test agent when planned, else the component's build agent.
      agentRequirementId:
        requirementFor("test", [test.componentId]) ??
        requirementFor("build", [test.componentId]),
    };
  }
  const security = plan.security.find((s) => s.id === stageId);
  if (security) {
    return {
      kind: "security",
      componentIds: security.componentIds,
      agentRequirementId:
        security.agentRequirementId ??
        requirementFor("security_review", security.componentIds),
    };
  }
  const deployment = plan.deployment.find((s) => s.id === stageId);
  if (deployment) {
    // No deploy agent is planned in EO-3: deployment stays denied by default.
    return {
      kind: "deployment",
      componentIds: [deployment.componentId],
      ...(deployment.environmentRequirementId
        ? { environmentRequirementId: deployment.environmentRequirementId }
        : {}),
    };
  }
  return undefined;
}
