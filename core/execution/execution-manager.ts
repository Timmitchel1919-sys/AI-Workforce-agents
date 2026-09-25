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
  grantAllows,
  operationWorkspaceAccess,
  isTerminalSession,
  requireExecutionId,
  validateExecutionRequest,
  validateInvocationRequest,
  type Agent,
  type CapabilityGrant,
  type Environment,
  type ExitClassification,
  type InvocationRequest,
  type InvocationResult,
  type SandboxInvocationOutcome,
  type ChangeSet,
  type RollbackReport,
  type WorkspaceControl,
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
import {
  buildStructuredInvocation,
  validateOperationInput as validateInput,
} from "./execution-operations.js";
import { beginAttempt, finishAttempt } from "./execution-sessions.js";
import {
  boundOutput,
  createExecutionReceipt,
  type InMemoryExecutionReceiptStore,
} from "./execution-receipts.js";
import {
  validateOperationOutput,
  type BoundedInvocationDispatcher,
  type ExecutionToolRegistry,
} from "./execution-tools.js";
import type { ToolExecutionEngine } from "../tools/tool-execution-engine.js";
import type { EnvironmentAdapterRegistry } from "./environment-adapters.js";

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
  /* ---- EO-4.2 bounded invocation (all optional: absent = no execution) ---- */
  /** Trusted, composition-registered execution tools. */
  executionTools?: ExecutionToolRegistry;
  /** The one bounded tool pipeline every invocation passes through. */
  toolEngine?: ToolExecutionEngine;
  dispatcher?: BoundedInvocationDispatcher;
  receipts?: InMemoryExecutionReceiptStore;
  /** Simultaneous invocations per environment instance. Default 2. */
  maxConcurrentPerEnvironment?: number;
  /** Deployment environment passed to the ToolExecutionEngine. Default local. */
  deploymentEnvironment?: Environment;
  /**
   * EO-4.3 workspace control (ChangeSets, rollback, lease release), provided
   * by the trusted workspace adapter. Reached only through this manager.
   */
  workspaceControl?: WorkspaceControl;
  /**
   * EO-4.5 environment execution adapters + runners (trusted composition).
   * Operations that declare an `environment` requirement need a ready
   * adapter + runner for the selected instance.
   */
  environmentAdapters?: EnvironmentAdapterRegistry;
}

interface ActiveInvocation {
  controller: AbortController;
  environmentInstanceId: string;
}

type StoredInvocation =
  "in_progress" | { fingerprint: string; result: InvocationResult };

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
  /** Running invocations, by session (cancel/kill aborts them). */
  private readonly active = new Map<string, ActiveInvocation>();
  /** Idempotency ledger: `${sessionId}\u0000${invocationId}`. */
  private readonly invocations = new Map<string, StoredInvocation>();

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
    options: { skipInput?: boolean } = {},
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

    // 5. Structured input + workspace paths. (Additional operations of a
    // persistent session are validated per invocation instead.)
    if (operation && !options.skipInput) {
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

    // A tool/operation can never widen the session network policy.
    if (
      operation &&
      evaluation &&
      (operation.networkAccess ?? "none") !== "none" &&
      evaluation.network.mode === "deny_all"
    ) {
      fail("policy", {
        code: "POLICY_DENIED",
        detail: "the operation needs network access the policy does not grant",
      });
    }

    // EO-4.4: the operation's toolchains must exist on the selected instance.
    if (operation && environmentInstanceId) {
      const instance = this.options.environments.getInstance(
        environmentInstanceId,
      );
      const absent = (operation.requiredToolchains ?? []).filter(
        (kind) => !instance?.toolchains.some((t) => t.kind === kind),
      );
      if (absent.length > 0) {
        fail("environment", {
          code: "TOOLCHAIN_UNAVAILABLE",
          detail: `required toolchain not present: ${absent.join(", ")}`,
        });
      }
    }

    // EO-4.5: adapter + runner readiness (platform-neutral; the registry
    // resolves from authoritative instance metadata, never from the request).
    let requiredProviderId: string | undefined;
    let routingFailed = false;
    if (operation?.environment && environmentInstanceId) {
      const adapters = this.options.environmentAdapters;
      const resolution = adapters?.resolve({
        projectId: request.projectId,
        environmentInstanceId,
        operation,
        executableId: this.options.executionTools?.get(operation.toolId)
          ?.executable.executableId,
      });
      if (!resolution) {
        routingFailed = true;
        fail("environment", {
          code: "ADAPTER_UNAVAILABLE",
          detail: "no environment execution adapters are configured",
        });
      } else if (!resolution.ready) {
        routingFailed = true;
        resolution.reasons.forEach((r) => fail("environment", r));
      } else {
        requiredProviderId = resolution.providerId;
      }
    }

    // 10. Sandbox + limits (provider availability is never faked).
    let sandbox: SandboxProvider | undefined;
    if (environmentInstanceId && evaluation && operation && !routingFailed) {
      sandbox = this.options.sandboxes.select(
        environmentInstanceId,
        evaluation.network,
        {
          workspaceAccess: operationWorkspaceAccess(operation),
          networkAccess: operation.networkAccess ?? "none",
          hostProcessAllowed: evaluation.rule?.hostProcess === true,
          executableId: this.options.executionTools?.get(operation.toolId)
            ?.executable.executableId,
          executionClass: operation.executionClass ?? "diagnostic",
          trustedHostBuildAllowed: evaluation.rule?.trustedHostBuild === true,
          ...(requiredProviderId ? { requiredProviderId } : {}),
        },
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
        ? {
            sandbox: { providerId: sandbox.providerId, kind: sandbox.kind },
            isolation: {
              filesystem: sandbox.capabilities.filesystemIsolation,
              network: sandbox.capabilities.networkIsolation,
            },
          }
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

    // A persistent (multi-operation) session validates input per invocation.
    const persistent = (request.operationIds ?? []).length > 0;
    const evaluated = await this.evaluate(
      principal,
      request,
      "prepare_execution",
      { skipInput: persistent && request.input === undefined },
    );
    // EO-4.3: every additional operation is evaluated on its own; any denial
    // denies the whole session (no partial grants).
    const extraIds = (request.operationIds ?? []).filter(
      (id) => id !== evaluated.operationId,
    );
    const extras: InternalContext[] = [];
    const extraReasons: ExecutionReason[] = [];
    for (const operationId of extraIds) {
      const { operationIds: _ops, input: _input, ...single } = request;
      void _ops;
      void _input;
      const e = await this.evaluate(
        principal,
        { ...single, operationId },
        "prepare_execution",
        { skipInput: true },
      );
      if (e.internal) extras.push(e.internal);
      else {
        extraReasons.push(
          ...e.reasons.map((r) => ({
            ...r,
            detail: `${operationId}: ${r.detail}`,
          })),
        );
      }
    }
    const eligible =
      evaluated.decision === "ELIGIBLE" && extraReasons.length === 0;
    const at = this.clock();
    const sessionId = this.newId("exs");
    const workspaceId = this.newId("ews");
    const internal = eligible ? evaluated.internal : undefined;
    const contexts = internal ? [internal, ...extras] : [];
    const workspace: ExecutionWorkspace = {
      workspaceId,
      sessionId,
      projectId: request.projectId,
      rootRef: `workspace://${request.projectId}/${workspaceId}`,
      // Write access only when an operation of THIS session writes: a
      // read-only analysis session never receives a writable workspace.
      mode: contexts.some(
        (c) => operationWorkspaceAccess(c.operation) === "write",
      )
        ? "read_write"
        : "read_only",
      status: internal ? "requested" : "released",
    };
    const grants: CapabilityGrant[] = contexts.flatMap((internal) =>
      internal.evaluation.capabilities.map((capability) => ({
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
      })),
    );

    let session: ExecutionSession = {
      sessionId,
      projectId: request.projectId,
      plan: evaluated.plan,
      stageId: request.stageId,
      stageKind: evaluated.stageKind ?? "build",
      operationId: evaluated.operationId ?? "",
      toolId: evaluated.toolId ?? "",
      ...(extraIds.length > 0
        ? {
            operationIds: [evaluated.operationId ?? "", ...extraIds],
            persistent: true,
          }
        : {}),
      agentId: evaluated.agentId ?? "",
      environmentInstanceId: evaluated.environmentInstanceId ?? "",
      policy: evaluated.policy ?? { policyId: "", version: 0 },
      approvalIds: [...new Set(contexts.flatMap((c) => c.approvalIds))],
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
    session = eligible
      ? transitionSession(session, "ready", at)
      : transitionSession(session, "denied", at, {
          reasons: [...evaluated.reasons, ...extraReasons],
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
        // A kill re-signals an invocation that is still winding down.
        if (kind === "kill" && planned.outcome === "already_cancelling") {
          this.active.get(session.sessionId)?.controller.abort();
        }
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
        // Propagate to the running invocation: the sandbox terminates it.
        if (planned.outcome === "cancelling") {
          this.active.get(session.sessionId)?.controller.abort();
        }
        if (isTerminalSession(planned.session.status)) {
          await this.releaseWorkspace(principal.id, planned.session);
        }
        return planned;
      }
    }
    throw new StateTransitionError(
      "execution session changed concurrently; retry",
    );
  }

  /* -------------------------------------------------------------- */
  /* Bounded invocation (EO-4.2)                                    */
  /* -------------------------------------------------------------- */

  /**
   * Invoke ONE registered operation inside a governed session:
   *
   *   structured request → session state → registered tool + operation →
   *   every pre-flight gate again (plan revision, agent, environment,
   *   approval, policy, input, workspace, sandbox) → capability grants →
   *   environment compatibility → limits + concurrency → ToolExecutionEngine
   *   → sandbox provider (trusted executable, validated argv, no shell)
   *   → output validation + redaction → receipt + audit.
   *
   * Any failed gate is a DENIAL (audited, receipted), never a tool failure.
   * Idempotent per `(session, invocationId)`: a retry replays the result.
   * The normal caller is the orchestrator; it is not exposed over HTTP.
   */
  async invoke(
    principal: OperatorPrincipal,
    raw: unknown,
  ): Promise<InvocationResult> {
    const request = validateInvocationRequest(raw);
    const session = await this.options.sessions.get(request.sessionId);
    if (!session) throw new NotFoundError("resource not found");
    this.authorize(principal, session.projectId, "prepare_execution");

    const key = `${session.sessionId}\u0000${request.invocationId}`;
    const fingerprint = JSON.stringify([
      request.toolId,
      request.operationId,
      Object.entries(request.input ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ]);
    const previous = this.invocations.get(key);
    if (previous === "in_progress") {
      throw new StateTransitionError("this invocation is already in progress");
    }
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new StateTransitionError(
          "invocationId was already used for a different invocation",
        );
      }
      return { ...previous.result, replayed: true };
    }
    this.record("invocation_requested", principal.id, session.projectId, {
      execution: session.sessionId,
      invocationId: request.invocationId,
      toolId: request.toolId,
      operationId: request.operationId,
    });
    this.invocations.set(key, "in_progress");
    try {
      const result = await this.performInvocation(principal, session, request);
      this.invocations.set(key, { fingerprint, result });
      return result;
    } catch (error) {
      this.invocations.delete(key);
      throw error;
    }
  }

  private async performInvocation(
    principal: OperatorPrincipal,
    session: ExecutionSession,
    request: InvocationRequest,
  ): Promise<InvocationResult> {
    const reasons: ExecutionReason[] = [];
    const deny = (code: ExecutionReason["code"], detail: string) =>
      reasons.push({ code, detail });
    const tool = this.options.executionTools?.get(request.toolId);
    const op = this.options.operations.get(request.operationId);

    if (session.status !== "ready" && session.status !== "running") {
      deny("POLICY_DENIED", `the execution session is ${session.status}`);
      // A session denied at preparation keeps its root causes visible.
      reasons.push(...session.reasons);
    }
    if (!tool) deny("TOOL_NOT_ALLOWED", "unknown tool (not registered)");
    if (!op) deny("TOOL_NOT_ALLOWED", "unknown operation (not registered)");
    if (
      tool &&
      op &&
      (!tool.operations.includes(op.id) || op.toolId !== tool.toolId)
    ) {
      deny("TOOL_NOT_ALLOWED", "the tool does not expose this operation");
    }
    const sessionOps = session.operationIds ?? [session.operationId];
    if (
      !sessionOps.includes(request.operationId) ||
      (op !== undefined && op.toolId !== request.toolId)
    ) {
      deny(
        "TOOL_NOT_ALLOWED",
        "the session was not prepared for this tool operation",
      );
    }
    if (!tool || !op || reasons.length > 0) {
      return this.denied(principal, session, request, reasons);
    }

    // Every pre-flight gate again, against the session's EXACT revision.
    const evaluated = await this.evaluate(
      principal,
      {
        projectId: session.projectId,
        planId: session.plan.planId,
        planVersion: session.plan.version,
        stageId: session.stageId,
        operationId: op.id,
        ...(request.input ? { input: request.input } : {}),
      },
      "prepare_execution",
    );
    reasons.push(...evaluated.reasons);
    if (evaluated.decision === "ELIGIBLE") {
      if (evaluated.agentId !== session.agentId) {
        deny(
          "AGENT_NOT_QUALIFIED",
          "the stage agent changed since the session was prepared",
        );
      }
      if (evaluated.environmentInstanceId !== session.environmentInstanceId) {
        deny(
          "ENVIRONMENT_UNAVAILABLE",
          "the stage environment changed since the session was prepared",
        );
      }
      // EO-4.5: no silent failover. A different runner means re-routing,
      // which needs a NEW session (policy, approval and routing re-evaluated).
      if (
        session.sandbox &&
        evaluated.sandbox &&
        evaluated.sandbox.providerId !== session.sandbox.providerId
      ) {
        deny(
          "RUNNER_UNAVAILABLE",
          "the routed runner changed since the session was prepared; re-routing requires a new session",
        );
      }
      if (
        evaluated.policy?.policyId !== session.policy.policyId ||
        evaluated.policy?.version !== session.policy.version
      ) {
        deny(
          "POLICY_DENIED",
          "the governing policy version changed since the session was prepared",
        );
      }
    }

    // REGISTERED + POLICY ALLOWED is not enough: the session must hold a
    // live grant for every capability, in exactly this context.
    const at = this.clock();
    const extra = tool.requiredCapabilities.filter(
      (c) => !op.requiredCapabilities.includes(c),
    );
    if (extra.length > 0) {
      deny(
        "TOOL_NOT_ALLOWED",
        `the operation does not declare tool capabilities: ${extra.join(", ")}`,
      );
    }
    for (const capability of op.requiredCapabilities) {
      const granted = session.grants.some((grant) =>
        grantAllows(grant, {
          sessionId: session.sessionId,
          projectId: session.projectId,
          agentId: session.agentId,
          environmentInstanceId: session.environmentInstanceId,
          workspaceId: session.workspace.workspaceId,
          toolId: tool.toolId,
          operationId: op.id,
          capability,
          at,
        }),
      );
      if (!granted) {
        deny("CAPABILITY_NOT_GRANTED", `no valid grant for ${capability}`);
      }
    }

    // Environment compatibility from trusted metadata — never "an executable
    // with a similar name exists somewhere on the host".
    const instance = this.options.environments.getInstance(
      session.environmentInstanceId,
    );
    const missing = tool.supportedEnvironmentCapabilities.filter(
      (c) =>
        !instance?.capabilities.some((d) => d.capability === c && d.available),
    );
    if (missing.length > 0) {
      deny(
        "ENVIRONMENT_UNAVAILABLE",
        `the environment lacks: ${missing.join(", ")}`,
      );
    }
    const missingToolchains = (op.requiredToolchains ?? []).filter(
      (kind) => !instance?.toolchains.some((t) => t.kind === kind),
    );
    if (missingToolchains.length > 0) {
      deny(
        "TOOLCHAIN_UNAVAILABLE",
        `required toolchain not present: ${missingToolchains.join(", ")}`,
      );
    }

    // Limits and concurrency (never unlimited spawning).
    const deadline =
      Date.parse(session.createdAt) + session.limits.sessionTimeoutMs;
    if (Date.parse(at) >= deadline) {
      deny("TIMEOUT", "the session time budget is exhausted");
    }
    if (session.attempts.length >= session.limits.maxToolCalls) {
      deny("RESOURCE_LIMIT", "the session tool-call limit is reached");
    }
    const provider = evaluated.sandbox
      ? this.options.sandboxes.get(evaluated.sandbox.providerId)
      : undefined;
    if (this.active.has(session.sessionId)) {
      deny("RESOURCE_LIMIT", "the session already has an active invocation");
    }
    const perEnvironment = [...this.active.values()].filter(
      (a) => a.environmentInstanceId === session.environmentInstanceId,
    ).length;
    const concurrency = Math.min(
      this.options.maxConcurrentPerEnvironment ?? 2,
      provider?.capabilities.maxConcurrentInvocations ?? 0,
    );
    if (provider && perEnvironment >= concurrency) {
      deny("RESOURCE_LIMIT", "the environment concurrency limit is reached");
    }
    const engine = this.options.toolEngine;
    const dispatcher = this.options.dispatcher;
    if (!engine || !dispatcher) {
      deny("SANDBOX_UNAVAILABLE", "bounded execution is not configured");
    }
    if (reasons.length > 0 || !provider || !engine || !dispatcher) {
      if (!provider && reasons.length === 0) {
        deny(
          "SANDBOX_UNAVAILABLE",
          "no sandbox provider can run this operation",
        );
      }
      return this.denied(principal, session, request, reasons);
    }

    // ---- prepare (server-side only) -----------------------------------
    const input = validateInput(op, request.input);
    const timeoutMs = Math.max(
      1,
      Math.min(
        session.limits.operationTimeoutMs,
        op.timeoutMs ?? Number.MAX_SAFE_INTEGER,
        deadline - Date.parse(at),
      ),
    );
    const invocation = buildStructuredInvocation(
      tool.executable,
      op.id,
      input,
      session.workspace.rootRef,
      timeoutMs,
    );

    let current = session;
    if (current.status === "ready")
      current = transitionSession(current, "running", at);
    const attemptId = this.newId("att");
    current = beginAttempt(current, attemptId, at);
    if (
      (await this.options.sessions.commit(current, session.revision)) !==
      "committed"
    ) {
      throw new StateTransitionError(
        "execution session changed concurrently; retry",
      );
    }
    const controller = new AbortController();
    this.active.set(session.sessionId, {
      controller,
      environmentInstanceId: session.environmentInstanceId,
    });
    this.record("operation_started", principal.id, session.projectId, {
      execution: session.sessionId,
      invocationId: request.invocationId,
      attemptId,
      toolId: tool.toolId,
      operationId: op.id,
      timeoutMs,
      providerId: provider.providerId,
    });

    const started = Date.now();
    let outcome: SandboxInvocationOutcome | undefined;
    let failure: ExecutionReason | undefined;
    let ref: string | undefined;
    let startFailure: ExecutionReason | undefined;
    const handle = await provider
      .start({
        sessionId: session.sessionId,
        projectId: session.projectId,
        environmentInstanceId: session.environmentInstanceId,
        workspace: session.workspace,
        limits: session.limits,
        network: session.network,
        grants: session.grants,
      })
      .catch((error: unknown) => {
        startFailure =
          error instanceof ExecutionDeniedError
            ? { code: error.code, detail: error.message }
            : {
                code: "SANDBOX_FAILURE",
                detail: "the sandbox could not be started",
              };
        return undefined;
      });
    try {
      if (!handle) {
        failure = startFailure ?? {
          code: "SANDBOX_FAILURE",
          detail: "the sandbox could not be started",
        };
      } else {
        ref = dispatcher.prepare({
          toolId: tool.toolId,
          provider,
          handle,
          invocation,
          signal: controller.signal,
          maxOutputBytes: session.limits.maxOutputBytes,
          knownSecrets: [],
        });
        const toolResult = await engine.execute(
          engine.createRequest({
            taskId: session.sessionId,
            agentId: session.agentId,
            projectId: session.projectId,
            toolId: tool.toolId,
            input: { invocationRef: ref },
            environment: this.options.deploymentEnvironment ?? "local",
            metadata: {
              operationId: op.id,
              invocationId: request.invocationId,
            },
          }),
        );
        if (toolResult.status === "success") {
          outcome = toolResult.output as SandboxInvocationOutcome;
        } else if (
          toolResult.status === "denied" ||
          toolResult.status === "approval_required"
        ) {
          failure = {
            code:
              toolResult.status === "approval_required"
                ? "APPROVAL_REQUIRED"
                : "TOOL_NOT_ALLOWED",
            detail: `tool pipeline refused the call: ${toolResult.error?.reason ?? toolResult.status}`,
          };
        } else if (toolResult.status === "timeout") {
          failure = { code: "TIMEOUT", detail: "the tool pipeline timed out" };
        } else {
          failure = {
            code: "SANDBOX_FAILURE",
            detail: "the sandbox reported a failure",
          };
        }
      }
    } finally {
      if (ref) dispatcher.discard(ref);
      this.active.delete(session.sessionId);
      if (handle) await provider.cleanup(handle).catch(() => undefined);
    }

    // ---- classify, validate output --------------------------------------
    // Redact + bound first: structured results are parsed from the redacted
    // text, so nothing unredacted reaches an agent, API or receipt.
    const stdout = outcome
      ? boundOutput(outcome.stdout.text, session.limits.maxOutputBytes)
      : undefined;
    let exitClass: ExitClassification;
    let result: Record<string, unknown> | undefined;
    const outcomeReasons: ExecutionReason[] = [];
    if (failure) {
      exitClass =
        failure.code === "TIMEOUT"
          ? "timeout"
          : failure.code === "SANDBOX_FAILURE"
            ? "sandbox_failure"
            : "denied";
      outcomeReasons.push(failure);
    } else {
      exitClass = outcome!.exitClass;
      if (controller.signal.aborted && exitClass !== "success")
        exitClass = "cancelled";
      if (exitClass !== "success" && outcome!.denial) {
        outcomeReasons.push(outcome!.denial);
      }
      if (exitClass === "success") {
        try {
          result = validateOperationOutput(op.output, stdout!.text);
        } catch (error) {
          exitClass = "tool_failure";
          outcomeReasons.push({
            code: "INVALID_OUTPUT",
            detail: error instanceof Error ? error.message : "invalid output",
          });
        }
      } else if (exitClass === "timeout") {
        outcomeReasons.push({
          code: "TIMEOUT",
          detail: `the operation exceeded ${timeoutMs}ms`,
        });
      } else if (exitClass === "cancelled") {
        outcomeReasons.push({
          code: "CANCELLED",
          detail: "the session was cancelled",
        });
      } else if (exitClass === "resource_limit") {
        outcomeReasons.push({
          code: "RESOURCE_LIMIT",
          detail: "a resource limit was exceeded",
        });
      }
    }
    const attemptStatus =
      exitClass === "success"
        ? "succeeded"
        : exitClass === "timeout"
          ? "timed_out"
          : exitClass === "cancelled"
            ? "cancelled"
            : "failed";

    // ---- persist session + receipt -------------------------------------
    const end = this.clock();
    const receiptId = this.newId("rcp");
    let finalStatus: ExecutionSession["status"] | undefined;
    for (let tries = 0; tries < 3; tries += 1) {
      const latest = await this.options.sessions.get(session.sessionId);
      if (!latest) break;
      if (isTerminalSession(latest.status)) break;
      let next = finishAttempt(
        latest,
        attemptId,
        attemptStatus,
        end,
        receiptId,
      );
      if (latest.persistent && next.status === "running") {
        // EO-4.3: a persistent (workspace) session stays open.
        if (
          (await this.options.sessions.commit(next, latest.revision)) ===
          "committed"
        ) {
          finalStatus = next.status;
          break;
        }
        continue;
      }
      // A cancel/kill that arrived mid-run always ends as `cancelled`.
      const target =
        next.status === "cancelling"
          ? "cancelled"
          : attemptStatus === "succeeded"
            ? "succeeded"
            : attemptStatus === "timed_out"
              ? "timed_out"
              : attemptStatus === "cancelled"
                ? "cancelled"
                : "failed";
      if (target === "cancelled" && next.status === "running") {
        next = transitionSession(next, "cancelling", end);
      }
      next = transitionSession(next, target, end);
      if (
        (await this.options.sessions.commit(next, latest.revision)) ===
        "committed"
      ) {
        finalStatus = next.status;
        break;
      }
    }
    if (finalStatus && isTerminalSession(finalStatus)) {
      await this.releaseWorkspace(principal.id, session);
    }

    const outputBytes = outcome
      ? outcome.stdout.originalBytes + outcome.stderr.originalBytes
      : 0;
    const truncated = Boolean(
      outcome &&
      (outcome.stdout.truncated ||
        outcome.stderr.truncated ||
        stdout?.truncated),
    );
    const receiptOutcome =
      exitClass === "denied" ? ("denied" as const) : attemptStatus;
    const receipt = createExecutionReceipt({
      receiptId,
      sessionId: session.sessionId,
      attemptId,
      projectId: session.projectId,
      plan: session.plan,
      stageId: session.stageId,
      agentId: session.agentId,
      environmentInstanceId: session.environmentInstanceId,
      toolId: tool.toolId,
      operationId: op.id,
      policy: session.policy,
      approvalIds: session.approvalIds,
      startedAt: at,
      endedAt: end,
      outcome: receiptOutcome,
      exitClass,
      artifacts: [],
      logRefs: [],
      resources: {
        wallClockMs: Date.now() - started,
        outputBytes,
        outputTruncated: truncated,
      },
      simulated: provider.capabilities.simulated === true,
      invocationId: request.invocationId,
      workspaceId: session.workspace.workspaceId,
      reasons: outcomeReasons,
      ...(outcome?.changes?.length ? { changes: outcome.changes } : {}),
      ...(outcome?.changeSetId ? { changeSetId: outcome.changeSetId } : {}),
      ...(outcome?.environment ? { environment: outcome.environment } : {}),
    });
    this.options.receipts?.record(receipt);
    this.record(
      exitClass === "success"
        ? "operation_completed"
        : exitClass === "timeout"
          ? "operation_timed_out"
          : exitClass === "cancelled"
            ? "operation_cancelled"
            : exitClass === "resource_limit"
              ? "resource_violation"
              : exitClass === "denied"
                ? "invocation_denied"
                : "operation_failed",
      principal.id,
      session.projectId,
      {
        execution: session.sessionId,
        invocationId: request.invocationId,
        attemptId,
        receiptId,
        exitClass,
        reasonCodes: outcomeReasons.map((r) => r.code),
        outputTruncated: truncated,
        ...(outcome?.changes?.length
          ? {
              changeSetId: outcome.changeSetId,
              changes: outcome.changes.map((c) => `${c.change}:${c.path}`),
            }
          : {}),
      },
    );
    return {
      invocationId: request.invocationId,
      sessionId: session.sessionId,
      outcome: receiptOutcome,
      exitClass,
      reasons: outcomeReasons,
      ...(stdout ? { output: { text: stdout.text, truncated } } : {}),
      ...(result && Object.keys(result).length > 0 ? { result } : {}),
      ...(outcome?.changes?.length ? { changes: outcome.changes } : {}),
      ...(outcome?.changeSetId ? { changeSetId: outcome.changeSetId } : {}),
      ...(outcome?.environment ? { environment: outcome.environment } : {}),
      receiptId,
      replayed: false,
    };
  }

  /* -------------------------------------------------------------- */
  /* Workspace sessions (EO-4.3)                                    */
  /* -------------------------------------------------------------- */

  private async scopedSession(
    principal: OperatorPrincipal,
    sessionId: string,
    capability: "view" | "prepare_execution" | "cancel_execution",
  ): Promise<ExecutionSession> {
    const session = await this.options.sessions.get(
      requireExecutionId(sessionId, "sessionId"),
    );
    if (!session) throw new NotFoundError("resource not found");
    if (
      !operatorCanAccessProject(principal, session.projectId) ||
      !this.options.projects.has(session.projectId)
    ) {
      throw new NotFoundError("resource not found");
    }
    this.authorize(principal, session.projectId, capability);
    return session;
  }

  /**
   * End a (persistent) session successfully and release its workspace lease.
   * Idempotent for terminal sessions. Never commits or pushes anything.
   */
  async completeSession(
    principal: OperatorPrincipal,
    sessionId: string,
  ): Promise<ExecutionSession> {
    const current = await this.scopedSession(
      principal,
      sessionId,
      "prepare_execution",
    );
    if (isTerminalSession(current.status)) return current;
    if (this.active.has(current.sessionId)) {
      throw new StateTransitionError(
        "an invocation is still running in this session",
      );
    }
    const at = this.clock();
    let next = current;
    if (next.status === "ready") next = transitionSession(next, "running", at);
    next = transitionSession(next, "succeeded", at);
    if (
      (await this.options.sessions.commit(next, current.revision)) !==
      "committed"
    ) {
      throw new StateTransitionError(
        "execution session changed concurrently; retry",
      );
    }
    this.record("session_completed", principal.id, current.projectId, {
      execution: current.sessionId,
      attempts: next.attempts.length,
    });
    await this.releaseWorkspace(principal.id, next);
    return next;
  }

  /** The session ChangeSet (metadata only: paths, hashes, sizes). */
  async getChangeSet(
    principal: OperatorPrincipal,
    sessionId: string,
  ): Promise<ChangeSet | undefined> {
    const session = await this.scopedSession(principal, sessionId, "view");
    return this.options.workspaceControl?.changeSet(
      session.workspace.workspaceId,
    );
  }

  /**
   * Revert ONLY the mutations this session made (never pre-existing or
   * foreign changes; never a global reset). Operators (`cancel_execution`).
   */
  async rollbackWorkspace(
    principal: OperatorPrincipal,
    sessionId: string,
  ): Promise<RollbackReport> {
    const session = await this.scopedSession(
      principal,
      sessionId,
      "cancel_execution",
    );
    const control = this.options.workspaceControl;
    if (!control)
      throw new StateTransitionError("workspace control is not configured");
    if (this.active.has(session.sessionId)) {
      throw new StateTransitionError(
        "an invocation is still running in this session",
      );
    }
    this.record("rollback_requested", principal.id, session.projectId, {
      execution: session.sessionId,
    });
    const report = await control.rollback(
      session.workspace.workspaceId,
      session.sessionId,
    );
    this.record("rollback_completed", principal.id, session.projectId, {
      execution: session.sessionId,
      changeSetId: report.changeSetId,
      reverted: report.reverted.length,
      skipped: report.skipped.length,
    });
    return report;
  }

  private async releaseWorkspace(
    actor: string,
    session: ExecutionSession,
  ): Promise<void> {
    const control = this.options.workspaceControl;
    if (!control) return;
    const report = await control
      .release(session.workspace.workspaceId, session.sessionId)
      .catch((error: unknown) => ({
        workspaceId: session.workspace.workspaceId,
        released: false,
        removedState: false,
        failure: error instanceof Error ? error.message : "cleanup failed",
      }));
    this.record("workspace_released", actor, session.projectId, {
      execution: session.sessionId,
      workspaceId: report.workspaceId,
      released: report.released,
      removedState: report.removedState,
      ...(report.failure ? { failure: report.failure } : {}),
    });
  }

  /** A denied invocation: audited + receipted; the session is untouched. */
  private denied(
    principal: OperatorPrincipal,
    session: ExecutionSession,
    request: InvocationRequest,
    reasons: readonly ExecutionReason[],
  ): InvocationResult {
    const at = this.clock();
    const receiptId = this.newId("rcp");
    const receipt = createExecutionReceipt({
      receiptId,
      sessionId: session.sessionId,
      attemptId: this.newId("att"),
      projectId: session.projectId,
      plan: session.plan,
      stageId: session.stageId,
      agentId: session.agentId,
      environmentInstanceId: session.environmentInstanceId,
      toolId: request.toolId,
      operationId: request.operationId,
      policy: session.policy,
      approvalIds: session.approvalIds,
      startedAt: at,
      endedAt: at,
      outcome: "denied",
      exitClass: "denied",
      artifacts: [],
      logRefs: [],
      resources: { wallClockMs: 0, outputBytes: 0, outputTruncated: false },
      simulated: false,
      invocationId: request.invocationId,
      reasons,
    });
    this.options.receipts?.record(receipt);
    this.record("invocation_denied", principal.id, session.projectId, {
      execution: session.sessionId,
      invocationId: request.invocationId,
      toolId: request.toolId,
      operationId: request.operationId,
      reasonCodes: reasons.map((r) => r.code),
      receiptId,
    });
    return {
      invocationId: request.invocationId,
      sessionId: session.sessionId,
      outcome: "denied",
      exitClass: "denied",
      reasons,
      receiptId,
      replayed: false,
    };
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
  const want = [...(request.operationIds ?? [])]
    .filter((id) => id !== session.operationId)
    .sort();
  const have = [...(session.operationIds ?? []).slice(1)].sort();
  return (
    JSON.stringify(want) === JSON.stringify(have) &&
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
    // EO-4.4: security checks run in the build environment of the component.
    const build = plan.build.find((b) =>
      security.componentIds.includes(b.componentId),
    );
    const buildEnvironment = build?.environmentRequirementId;
    // Automated checks (scanners) run as the component's build agent when no
    // security reviewer is planned; an AGENT review always needs a reviewer.
    const automatedFallback =
      security.check === "security_agent_review"
        ? undefined
        : build?.agentRequirementId;
    return {
      kind: "security",
      componentIds: security.componentIds,
      ...(buildEnvironment
        ? { environmentRequirementId: buildEnvironment }
        : {}),
      agentRequirementId:
        security.agentRequirementId ??
        requirementFor("security_review", security.componentIds) ??
        automatedFallback,
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
