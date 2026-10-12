/**
 * SecurityGovernor — the single policy decision point.
 *
 *   identity → emergency stop → agent trust → project isolation → tool trust →
 *   model/data trust → permission (least privilege) → resource & data class →
 *   risk → policy resolution → trust modifiers → approval → audit → threat feed
 *
 * Deterministic (no model calls) and fail-closed: an unexpected error while
 * deciding is a DENY. The runtime, the orchestrator and the model gateway all
 * ask this class; nothing else decides.
 */
import { randomBytes } from "node:crypto";
import type {
  OrchTask,
  ExecutionRun,
} from "../../contracts/execution-orchestration.js";
import {
  ACTION_CLASSES,
  POLICY_LAYERS,
  type ActionClass,
  type ActionRequest,
  type AlertSeverity,
  type DriftReport,
  type GovEnvironment,
  type GovPolicy,
  type SecurityDecision,
  type MatchedPolicy,
  type PolicyEffect,
  type ResourceInfo,
  type GovRisk,
  type TrustState,
} from "../../contracts/security-governance.js";
import type { Repository } from "../../contracts/persistence.js";
import type {
  ActionGate,
  GateInput,
  GateVerdict,
} from "../execution-runtime/tools.js";
import type { RuntimeSession } from "../../contracts/execution-runtime.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
import type {
  SecurityAlertService,
  ThreatDetector,
  ThreatSignal,
} from "./alerts.js";
import type { GovernanceApprovals } from "./approvals.js";
import type { EmergencyStop } from "./emergency.js";
import type { GovernanceLedger } from "./ledger.js";
import { checkPermission } from "./permissions.js";
import {
  BUILTIN_POLICIES,
  baselineEffect,
  effectRank,
  resolvePolicies,
  validateCustomPolicy,
  type EvalContext,
} from "./policy-engine.js";
import {
  SENSITIVE_KINDS,
  classifyContent,
  describeResource,
  inferEnvironment,
  maxDataClass,
} from "./resources.js";
import { assessRisk, riskRank } from "./risk-engine.js";
import type { TrustRegistry } from "./trust-registry.js";

export class GovernanceError extends Error {
  constructor(
    readonly code:
      "forbidden" | "not_found" | "invalid_request" | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "GovernanceError";
  }
}

/* ------------------------------------------------------------------ */
/* Policy store                                                        */
/* ------------------------------------------------------------------ */

export class PolicyStore {
  private readonly repo: Repository<GovPolicy>;
  constructor(
    repo: Repository<GovPolicy>,
    private readonly clock: () => string,
  ) {
    this.repo = new SyncCache(repo);
  }

  all(): GovPolicy[] {
    return [...BUILTIN_POLICIES, ...this.repo.list()];
  }
  get(policyId: string): GovPolicy | undefined {
    return this.all().find((p) => p.policyId === policyId);
  }

  create(input: Partial<GovPolicy>, by: string, admin: boolean): GovPolicy {
    const problem = validateCustomPolicy(input);
    if (problem) throw new GovernanceError("invalid_request", problem);
    if (input.critical && !admin)
      throw new GovernanceError(
        "forbidden",
        "only an administrator can create a critical policy",
      );
    const policyId = `pol-${randomBytes(4).toString("hex")}`;
    const now = this.clock();
    const policy: GovPolicy = {
      id: policyId,
      policyId,
      name: input.name!.trim().slice(0, 120),
      description: (input.description ?? "").slice(0, 400),
      layer: input.layer!,
      priority: Math.trunc(input.priority ?? 500),
      scope: { ...(input.scope ?? {}) },
      conditions: { ...(input.conditions ?? {}) },
      effect: input.effect!,
      ...(input.approvalRequirement
        ? { approvalRequirement: input.approvalRequirement }
        : {}),
      ...(input.securityRequirement
        ? { securityRequirement: input.securityRequirement }
        : {}),
      status: "ENABLED",
      builtin: false,
      critical: input.critical === true,
      version: 1,
      createdAt: now,
      updatedAt: now,
      updatedBy: by,
    };
    this.repo.upsert(policy);
    return policy;
  }

  private mustEditable(policyId: string, admin: boolean): GovPolicy {
    const p = this.get(policyId);
    if (!p) throw new GovernanceError("not_found", "policy not found");
    if (p.builtin)
      throw new GovernanceError(
        "forbidden",
        "built-in system policies cannot be changed, disabled or deleted",
      );
    if (p.critical && !admin)
      throw new GovernanceError(
        "forbidden",
        "only an administrator can change a critical policy",
      );
    return p;
  }

  update(
    policyId: string,
    patch: Partial<GovPolicy>,
    by: string,
    admin: boolean,
  ): GovPolicy {
    const cur = this.mustEditable(policyId, admin);
    const merged: Partial<GovPolicy> = {
      ...cur,
      ...patch,
      scope: patch.scope ?? cur.scope,
      conditions: patch.conditions ?? cur.conditions,
    };
    const problem = validateCustomPolicy(merged);
    if (problem) throw new GovernanceError("invalid_request", problem);
    if (patch.critical === true && !admin)
      throw new GovernanceError(
        "forbidden",
        "only an administrator can mark a policy critical",
      );
    const next: GovPolicy = {
      ...cur,
      name: (patch.name ?? cur.name).trim().slice(0, 120),
      description: (patch.description ?? cur.description).slice(0, 400),
      layer: patch.layer ?? cur.layer,
      priority:
        patch.priority !== undefined
          ? Math.trunc(patch.priority)
          : cur.priority,
      scope: patch.scope ?? cur.scope,
      conditions: patch.conditions ?? cur.conditions,
      effect: patch.effect ?? cur.effect,
      critical: patch.critical ?? cur.critical,
      version: cur.version + 1,
      updatedAt: this.clock(),
      updatedBy: by,
    };
    this.repo.upsert(next);
    return next;
  }

  setStatus(
    policyId: string,
    status: "ENABLED" | "DISABLED",
    by: string,
    admin: boolean,
  ): GovPolicy {
    const cur = this.mustEditable(policyId, admin);
    const next: GovPolicy = {
      ...cur,
      status,
      version: cur.version + 1,
      updatedAt: this.clock(),
      updatedBy: by,
    };
    this.repo.upsert(next);
    return next;
  }
}

/* ------------------------------------------------------------------ */
/* Governor                                                            */
/* ------------------------------------------------------------------ */

export interface AgentDirectory {
  get(
    agentId: string,
  ): { id: string; allowedProjects: readonly string[] } | undefined;
}

export interface GovernorDeps {
  policies: PolicyStore;
  trust: TrustRegistry;
  approvals: GovernanceApprovals;
  alerts: SecurityAlertService;
  detector: ThreatDetector;
  ledger: GovernanceLedger;
  emergency: EmergencyStop;
  agents: AgentDirectory;
  clock: () => string;
  /** Called after an agent is suspended (cancel its live executions). */
  onSuspend?: (agentId: string, reason: string) => void;
  /** Session annotation for review routing / drift. */
  annotateSession?: (
    executionId: string,
    patch: { reviewRequired?: string[]; drift?: DriftReport },
  ) => void;
}

export interface CheckOptions {
  /** `real` writes the normal governance trail; `simulated` marks it as a simulation. */
  record?: "real" | "simulated";
  /** Create a human approval request when one is needed. */
  approvals?: boolean;
  /** Raise alerts / feed the threat detector. */
  alerts?: boolean;
}

const SEVERITY_OF_RISK: Record<GovRisk, AlertSeverity> = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
};

function describePoints(factors: { factor: string; points: number }[]): string {
  return (
    factors
      .map((f) => `${f.factor} ${f.points > 0 ? "+" : ""}${f.points}`)
      .join(", ") || "no risk factors"
  );
}

export class SecurityGovernor {
  stats = { evaluated: 0, lowAllowed: 0, denied: 0, approvalsRequested: 0 };

  constructor(private readonly d: GovernorDeps) {}

  /* ---------------------------------------------------------------- */

  check(req: ActionRequest, opts: CheckOptions = {}): SecurityDecision {
    // Malformed requests are refused outright (fail closed), never defaulted into something allowed.
    if (
      !req ||
      !(ACTION_CLASSES as readonly string[]).includes(req.action) ||
      typeof req.resource !== "string" ||
      req.resource.trim() === "" ||
      typeof req.projectId !== "string" ||
      req.projectId.trim() === ""
    ) {
      const safe: ActionRequest = {
        projectId:
          typeof req?.projectId === "string" ? req.projectId : "unknown",
        action: "READ",
        resource:
          typeof req?.resource === "string" && req.resource
            ? req.resource
            : "unknown",
        ...(req?.agentId ? { agentId: req.agentId } : {}),
      };
      return this.failClosed(
        safe,
        new Error(
          "invalid request: action, resource and projectId are required",
        ),
      );
    }
    try {
      return this.decide(req, opts);
    } catch (error) {
      // Fail closed: a governor that cannot finish deciding denies.
      const decision = this.failClosed(req, error);
      this.d.ledger.record("policy.denied", {
        actor: req.agentId ?? req.principalId ?? "unknown",
        severity: "HIGH",
        projectId: req.projectId,
        agentId: req.agentId,
        action: req.action,
        resource: req.resource,
        result: "DENY",
        detail: { reason: "governor error (fail closed)" },
      });
      return decision;
    }
  }

  simulate(req: ActionRequest): SecurityDecision {
    return this.check(
      { ...req, dryRun: true },
      { record: "simulated", approvals: false, alerts: false },
    );
  }

  private failClosed(req: ActionRequest, error: unknown): SecurityDecision {
    const resource = describeResource(req.resource, req.environment);
    const risk = assessRisk({
      action: req.action,
      resource,
      environment: req.environment ?? "DEVELOPMENT",
    });
    const why = `the policy engine could not evaluate this request (${maskSecrets(error instanceof Error ? error.message : "error")})`;
    return {
      decisionId: `dec-${randomBytes(4).toString("hex")}`,
      effect: "DENY",
      risk,
      resource,
      environment: req.environment ?? "DEVELOPMENT",
      action: req.action,
      policies: [],
      overruled: [],
      obligations: { approval: false, review: false, securityReview: false },
      reasons: [why],
      explanation: `Decision: DENY\nReason: ${why}`,
      simulated: false,
      at: this.d.clock(),
    };
  }

  private decide(req: ActionRequest, opts: CheckOptions): SecurityDecision {
    const o: Required<CheckOptions> = {
      record: opts.record ?? (req.dryRun ? "simulated" : "real"),
      approvals: opts.approvals ?? !req.dryRun,
      alerts: opts.alerts ?? !req.dryRun,
    };
    const { trust, emergency, agents, policies, approvals } = this.d;
    const reasons: string[] = [];
    const resource = describeResource(req.resource, req.environment);
    const environment: GovEnvironment =
      req.environment ?? (resource.production ? "PRODUCTION" : "DEVELOPMENT");
    const contentHasSecret =
      !!req.content && classifyContent(req.content) === "SECRET";
    const dataClass = maxDataClass(
      req.dataClass ?? resource.dataClass,
      contentHasSecret ? "SECRET" : "PUBLIC",
    );
    const agentTrust: TrustState | undefined = req.agentId
      ? trust.agentState(req.agentId)
      : undefined;
    const count = Math.max(1, Math.trunc(req.count ?? 1));
    const risk = assessRisk({
      action: req.action,
      resource,
      environment,
      count,
      ...(req.reversible !== undefined ? { reversible: req.reversible } : {}),
      dataClass,
      ...(agentTrust ? { agentTrust } : {}),
    });
    reasons.push(
      `Environment: ${environment}`,
      `Action: ${req.action} on ${resource.kind.toLowerCase().replace(/_/g, " ")} "${resource.label}"`,
    );
    reasons.push(
      `Risk: ${risk.level} (score ${risk.score}: ${describePoints(risk.factors)})`,
      `Blast radius: ${risk.blastRadius}`,
    );

    const finish = (
      effect: PolicyEffect,
      extra: {
        policies?: MatchedPolicy[];
        overruled?: MatchedPolicy[];
        obligations?: SecurityDecision["obligations"];
        approval?: SecurityDecision["approval"];
        gate?: string;
        signal?: ThreatSignal["kind"];
        winner?: MatchedPolicy;
        alertTitle?: string;
      } = {},
    ): SecurityDecision => {
      const obligations = extra.obligations ?? {
        approval: false,
        review: false,
        securityReview: false,
      };
      const lines = [`Decision: ${effect}`, `Reason: ${reasons.join("; ")}`];
      if (extra.winner)
        lines.push(`Policy: ${extra.winner.name} (${extra.winner.layer})`);
      else if (extra.gate) lines.push(`Control: ${extra.gate}`);
      if (extra.approval)
        lines.push(
          `Approval: ${extra.approval.state === "APPROVED" ? "granted" : "required"} (${extra.approval.approvalId})`,
        );
      else if (
        effect === "REQUIRE_APPROVAL" ||
        effect === "REQUIRE_SECURITY_REVIEW"
      )
        lines.push("Approval: required");
      const decision: SecurityDecision = {
        decisionId: `dec-${randomBytes(4).toString("hex")}`,
        effect,
        risk,
        resource,
        environment,
        action: req.action,
        policies: extra.policies ?? [],
        overruled: extra.overruled ?? [],
        obligations,
        ...(extra.approval ? { approval: extra.approval } : {}),
        reasons: [...reasons],
        explanation: maskSecrets(lines.join("\n")),
        ...(agentTrust ? { agentTrust } : {}),
        simulated: o.record === "simulated",
        at: this.d.clock(),
      };
      this.afterDecision(
        req,
        decision,
        o,
        extra.signal,
        extra.alertTitle ?? extra.gate ?? extra.winner?.name,
      );
      return decision;
    };

    // 1. Emergency stop: nothing new executes.
    if (emergency.halted()) {
      reasons.push(
        "AI WORKFORCE EXECUTION PAUSED — the emergency stop is active",
      );
      return finish("DENY", { gate: "Emergency stop" });
    }
    // 2. Identity and agent trust.
    if (req.agentId) {
      const known = agents.get(req.agentId);
      if (!known) {
        reasons.push(`Unknown agent "${req.agentId}"`);
        return finish("DENY", { gate: "Identity", signal: "DENIED" });
      }
      if (agentTrust === "SUSPENDED" || agentTrust === "DISABLED") {
        reasons.push(`Agent ${req.agentId} is ${agentTrust}`);
        return finish("DENY", { gate: "Agent trust", signal: "DENIED" });
      }
      // 3. Project isolation.
      if (
        !known.allowedProjects.includes("*") &&
        !known.allowedProjects.includes(req.projectId)
      ) {
        reasons.push(
          `Agent ${req.agentId} is not permitted to work on project ${req.projectId}`,
        );
        return finish("DENY", {
          gate: "Project isolation",
          signal: "SCOPE_VIOLATION",
        });
      }
    } else if (!req.principalId) {
      reasons.push("No agent or user identity on the request");
      return finish("DENY", { gate: "Identity" });
    }
    if (
      resource.kind === "PROJECT" &&
      resource.label.replace(/^project:\s*/, "") !== req.projectId
    ) {
      reasons.push(
        `The resource belongs to a different project (${resource.label})`,
      );
      return finish("DENY", {
        gate: "Project isolation",
        signal: "SCOPE_VIOLATION",
      });
    }
    // 4. Tool trust (runtime tools run in the local workspace environment).
    if (req.toolId) {
      const tool = trust.toolAllows(req.toolId, req.agentId, "DEVELOPMENT");
      if (!tool.ok) {
        reasons.push(tool.reason);
        return finish("DENY", { gate: "Tool trust", signal: "DENIED" });
      }
    }
    // 5. Model / data trust.
    if (req.modelId || req.provider) {
      const provider = req.provider ?? req.modelId?.split("/")[0] ?? "unknown";
      const model =
        req.modelId?.split("/").slice(1).join("/") || req.modelId || "*";
      const m = trust.modelAllows(provider, model, req.taskType, dataClass);
      if (!m.ok) {
        reasons.push(m.reason);
        return finish("DENY", { gate: "Model trust" });
      }
    }
    // 6. Least privilege.
    const perm = checkPermission(req, resource);
    if (!perm.ok) {
      reasons.push(perm.reason);
      return finish("DENY", {
        gate: `Permission (${perm.rule})`,
        signal:
          resource.kind === "POLICY" || resource.kind === "AGENT"
            ? "PRIVILEGE_ESCALATION"
            : perm.rule === "sensitive_scope" || perm.rule === "task_profile"
              ? "SCOPE_VIOLATION"
              : "DENIED",
      });
    }
    if (req.action === "DELETE") this.feed(req, "DESTRUCTIVE_REQUEST", o);

    // 7. Policy resolution.
    const ctx: EvalContext = {
      request: req,
      resource,
      environment,
      risk,
      ...(agentTrust ? { agentTrust } : {}),
      contentHasSecret,
      dataClass,
      count,
    };
    const resolved = resolvePolicies(policies.all(), ctx);
    let effect: PolicyEffect = resolved.effect;
    const obligations = { ...resolved.obligations };
    const base = baselineEffect(risk, req.action);
    if (effectRank(base.effect) > effectRank(effect)) {
      effect = base.effect;
      reasons.push(`Baseline: ${base.reason}`);
      if (base.effect === "REQUIRE_APPROVAL") obligations.approval = true;
      if (base.effect === "REQUIRE_REVIEW") obligations.review = true;
    }
    if (resolved.winner)
      reasons.push(
        `Policy: ${resolved.winner.name} → ${resolved.winner.effect}`,
      );
    for (const m of resolved.matched)
      if (m.policyId !== resolved.winner?.policyId)
        reasons.push(`Also applies: ${m.name} (${m.effect})`);
    // Trust modifiers can only add restriction.
    if (
      agentTrust === "LIMITED" &&
      req.action !== "READ" &&
      req.action !== "ANALYZE" &&
      effectRank(effect) < effectRank("REQUIRE_REVIEW")
    ) {
      effect = "REQUIRE_REVIEW";
      obligations.review = true;
      reasons.push("Agent trust LIMITED: changes need a review");
    }
    if (
      agentTrust === "REVIEW_REQUIRED" &&
      req.action !== "READ" &&
      req.action !== "ANALYZE" &&
      effectRank(effect) < effectRank("REQUIRE_APPROVAL")
    ) {
      effect = "REQUIRE_APPROVAL";
      obligations.approval = true;
      reasons.push(
        "Agent trust REVIEW_REQUIRED: every change needs human approval",
      );
    }
    // Tool-level approval rule.
    if (req.toolId) {
      const t = trust.toolAllows(req.toolId, req.agentId, "DEVELOPMENT");
      if (
        (t.approval === "ALWAYS" ||
          (t.approval === "HIGH_RISK" &&
            riskRank(risk.level) >= riskRank("HIGH"))) &&
        effectRank(effect) < effectRank("REQUIRE_APPROVAL")
      ) {
        effect = "REQUIRE_APPROVAL";
        obligations.approval = true;
        reasons.push(`Tool "${req.toolId}" requires approval`);
      }
    }

    // 8. Approval.
    let approval: SecurityDecision["approval"];
    if (effect === "REQUIRE_APPROVAL" || effect === "REQUIRE_SECURITY_REVIEW") {
      const granted = approvals.approvedFor(req);
      if (granted) {
        approval = { approvalId: granted, state: "APPROVED" };
        reasons.push(
          `Approval ${granted} was granted by a human for exactly this action`,
        );
        if (o.approvals) approvals.consume(granted);
        effect = "ALLOW";
      } else if (o.approvals) {
        const draft = this.draft(
          req,
          resource,
          environment,
          risk,
          effect,
          resolved.matched,
          obligations,
          reasons,
        );
        const asked = approvals.request(req, draft);
        approval = { approvalId: asked.approvalId, state: "PENDING" };
        if (asked.created) this.stats.approvalsRequested++;
      }
    }
    return finish(effect, {
      policies: resolved.matched,
      overruled: resolved.overruled,
      obligations,
      ...(approval ? { approval } : {}),
      ...(resolved.winner ? { winner: resolved.winner } : {}),
      ...(effect === "DENY" && resolved.winner
        ? {
            signal:
              resource.kind === "SECRET" || resource.kind === "ENV_FILE"
                ? ("SECRET_ACCESS" as const)
                : resource.kind === "POLICY" || resource.kind === "AGENT"
                  ? ("PRIVILEGE_ESCALATION" as const)
                  : ("DENIED" as const),
          }
        : {}),
    });
  }

  /** A decision shell used to describe a pending approval. */
  private draft(
    req: ActionRequest,
    resource: ResourceInfo,
    environment: GovEnvironment,
    risk: SecurityDecision["risk"],
    effect: PolicyEffect,
    matched: MatchedPolicy[],
    obligations: SecurityDecision["obligations"],
    reasons: string[],
  ): SecurityDecision {
    const explanation = `Approval needed: ${reasons.join("; ")}`;
    return {
      decisionId: "draft",
      effect,
      risk,
      resource,
      environment,
      action: req.action,
      policies: matched,
      overruled: [],
      obligations,
      reasons: [...reasons],
      explanation,
      simulated: false,
      at: this.d.clock(),
    };
  }

  private feed(
    req: ActionRequest,
    kind: ThreatSignal["kind"],
    o: Required<CheckOptions>,
  ): void {
    if (!o.alerts || !req.agentId) return;
    const response = this.d.detector.ingest({
      at: Date.parse(this.d.clock()),
      agentId: req.agentId,
      projectId: req.projectId,
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.executionId ? { executionId: req.executionId } : {}),
      kind,
      resource: req.resource,
    });
    if (response.suspend)
      this.suspendAgent(
        response.suspend.agentId,
        "security-governor",
        response.suspend.reason,
      );
    else if (
      response.reviewRequired &&
      this.d.trust.agentState(response.reviewRequired.agentId) === "TRUSTED"
    )
      this.d.trust.setAgentState(
        response.reviewRequired.agentId,
        "REVIEW_REQUIRED",
        "security-governor",
        response.reviewRequired.reason,
        "HIGH",
      );
  }

  private afterDecision(
    req: ActionRequest,
    d: SecurityDecision,
    o: Required<CheckOptions>,
    signal: ThreatSignal["kind"] | undefined,
    title: string | undefined,
  ): void {
    this.stats.evaluated++;
    const trivial =
      d.effect === "ALLOW" && d.risk.level === "LOW" && !d.approval;
    const who = req.agentId ?? req.principalId ?? "unknown";
    const base = {
      actor: who,
      projectId: req.projectId,
      agentId: req.agentId,
      taskId: req.taskId,
      executionId: req.executionId,
      toolId: req.toolId,
      action: req.action,
      resource: req.resource,
      risk: d.risk.level,
      policyIds: d.policies.map((p) => p.policyId),
    };
    if (o.record === "simulated") {
      this.d.ledger.record("policy.simulated", {
        ...base,
        result: d.effect,
        detail: { environment: d.environment },
      });
      return;
    }
    if (trivial) {
      this.stats.lowAllowed++;
      return;
    }
    this.d.ledger.record("policy.evaluated", {
      ...base,
      result: d.effect,
      detail: {
        environment: d.environment,
        score: d.risk.score,
        decisionId: d.decisionId,
      },
    });
    if (riskRank(d.risk.level) >= riskRank("MEDIUM"))
      this.d.ledger.record("risk.calculated", {
        ...base,
        result: d.risk.level,
        detail: { score: d.risk.score, blast: d.risk.blastRadius },
      });
    if (req.toolId)
      this.d.ledger.record(
        d.effect === "DENY" && d.reasons.some((r) => /Tool |tool /.test(r))
          ? "tool.denied"
          : "tool.authorized",
        { ...base, result: d.effect },
      );
    if (d.effect === "ALLOW")
      this.d.ledger.record("policy.allowed", {
        ...base,
        result: "ALLOW",
        detail: { approval: d.approval?.approvalId ?? "" },
      });
    if (d.effect === "DENY") {
      this.stats.denied++;
      this.d.ledger.record("policy.denied", {
        ...base,
        severity: SEVERITY_OF_RISK[d.risk.level],
        result: "DENY",
        detail: { reason: d.reasons.at(-1) ?? "" },
      });
      this.d.ledger.record("execution.blocked", {
        ...base,
        severity: SEVERITY_OF_RISK[d.risk.level],
        result: "BLOCKED",
      });
    }
    if (req.content && classifyContent(req.content) === "SECRET")
      this.d.ledger.record("secret.detected", {
        ...base,
        severity: "HIGH",
        result: "BLOCKED",
        detail: { where: "content of a requested write" },
      });
    if (!o.alerts) return;
    if (
      d.effect === "DENY" &&
      d.reasons[0] !==
        "AI WORKFORCE EXECUTION PAUSED — the emergency stop is active" &&
      !d.reasons.some((r) => /PAUSED/.test(r))
    ) {
      const policyViolation =
        d.policies.length > 0 ||
        d.reasons.some((r) =>
          /least privilege|not declared|sensitive|not permitted|not registered|Unknown agent|suspended|disabled/i.test(
            r,
          ),
        );
      if (policyViolation) {
        const severity: AlertSeverity =
          riskRank(d.risk.level) >= riskRank("HIGH")
            ? SEVERITY_OF_RISK[d.risk.level]
            : "MEDIUM";
        this.d.alerts.raise({
          severity,
          source: "POLICY",
          event: "policy_violation",
          description: `${who} attempted ${req.action} on ${d.resource.label}: ${d.reasons.at(-1) ?? "denied"}`,
          projectId: req.projectId,
          agentId: req.agentId,
          taskId: req.taskId,
          executionId: req.executionId,
          evidence: {
            action: req.action,
            resource: d.resource.label,
            risk: d.risk.level,
            control: title ?? "policy",
            environment: d.environment,
          },
          dedupeKey: `policy:${req.agentId ?? who}:${req.action}:${d.resource.label}`,
        });
      }
    }
    if (signal) this.feed(req, signal, o);
    else if (d.effect === "DENY" && req.agentId) this.feed(req, "DENIED", o);
  }

  /* ---------------------------------------------------------------- */
  /* Agent suspension                                                  */
  /* ---------------------------------------------------------------- */

  suspendAgent(agentId: string, by: string, reason: string): void {
    this.d.trust.setAgentState(agentId, "SUSPENDED", by, reason, "CRITICAL");
    this.d.ledger.record("agent.suspended", {
      actor: by,
      severity: "CRITICAL",
      agentId,
      result: "SUSPENDED",
      detail: { reason },
    });
    this.d.alerts.raise({
      severity: "CRITICAL",
      source: "AGENT_TRUST",
      event: "agent_suspended",
      description: `${agentId} was suspended: ${reason}`,
      agentId,
      evidence: { by, reason },
      dedupeKey: `suspended:${agentId}`,
    });
    try {
      this.d.onSuspend?.(agentId, reason);
    } catch {
      /* the suspension stands even if cleanup fails */
    }
  }

  setAgentTrust(
    agentId: string,
    state: TrustState,
    by: string,
    admin: boolean,
    reason?: string,
  ): void {
    if (!this.d.agents.get(agentId))
      throw new GovernanceError("not_found", "agent not found");
    const cur = this.d.trust.agentState(agentId);
    // Restoring trust, or lifting a suspension, is an administrator decision.
    const lifting =
      (cur === "SUSPENDED" ||
        cur === "DISABLED" ||
        cur === "REVIEW_REQUIRED") &&
      (state === "TRUSTED" || state === "LIMITED");
    if (lifting && !admin)
      throw new GovernanceError(
        "forbidden",
        "only an administrator can lift a suspension or restore trust",
      );
    if (state === "SUSPENDED")
      return this.suspendAgent(agentId, by, reason ?? "suspended by the user");
    this.d.trust.setAgentState(agentId, state, by, reason);
    this.d.ledger.record(
      state === "TRUSTED" || state === "LIMITED"
        ? "agent.enabled"
        : "agent.trust_changed",
      {
        actor: by,
        severity: "HIGH",
        agentId,
        result: state,
        detail: { reason: reason ?? "" },
      },
    );
  }

  /* ---------------------------------------------------------------- */
  /* Task level (orchestrator)                                          */
  /* ---------------------------------------------------------------- */

  assessTask(input: {
    run: ExecutionRun;
    task: OrchTask;
    agentId: string;
    modelId?: string;
  }): {
    effect: PolicyEffect;
    decision: SecurityDecision;
    summary: NonNullable<OrchTask["governance"]>;
  } {
    const { run, task, agentId } = input;
    const text = `${run.objective} ${task.title} ${task.description} ${task.prompt}`;
    const stated = inferEnvironment(text);
    const environment: GovEnvironment =
      stated ?? (task.type === "DEPLOYMENT" ? "PRODUCTION" : "DEVELOPMENT");
    const projectId = run.projectId;
    const nouns =
      /\b(delete|remove|drop|destroy|wipe|verwijder\w*)\b/i.test(text) ||
      task.destructive;
    const targets: { action: ActionClass; resource: string; count: number }[] =
      [];
    if (task.type === "DEPLOYMENT")
      targets.push({
        action: "DEPLOY",
        resource: `deploy:${environment.toLowerCase()}`,
        count: 1,
      });
    else if (task.type === "INTEGRATION")
      targets.push({ action: "PUBLISH", resource: "branch:main", count: 1 });
    else if (nouns) {
      const lower = text.toLowerCase();
      const resource = /firebase\s+project/.test(lower)
        ? `firebase-project:${environment.toLowerCase()}`
        : /\b(database|firestore|db|collection)\b/.test(lower)
          ? `database:${environment.toLowerCase()}`
          : /\b(repository|repo)\b/.test(lower)
            ? `repo:${projectId}`
            : /\bsecret|api key|token\b/.test(lower)
              ? "secret:requested"
              : /\bproject\b/.test(lower)
                ? `project:${projectId}`
                : /\bworkflow\b/.test(lower)
                  ? `workflow:${projectId}`
                  : /\bagent\b/.test(lower)
                    ? "agent:requested"
                    : (task.resources[0] ?? "unknown");
      targets.push({ action: "DELETE", resource, count: 1 });
    } else if (
      ["REVIEW", "SECURITY", "ANALYSIS", "RESEARCH"].includes(task.type)
    )
      targets.push({
        action: "READ",
        resource: `project:${projectId}`,
        count: 1,
      });
    else {
      const files = task.resources.slice(0, 20);
      // A task that declares no write set changes nothing: it is assessed as a read of the project.
      if (files.length === 0)
        targets.push({
          action: "READ",
          resource: `project:${projectId}`,
          count: 1,
        });
      for (const f of files)
        targets.push({
          action: "UPDATE",
          resource: f.startsWith("file:") || f.includes(":") ? f : `file:${f}`,
          count: files.length,
        });
    }
    let worst: SecurityDecision | undefined;
    for (const t of targets) {
      const d = this.check(
        {
          projectId,
          action: t.action,
          resource: t.resource,
          agentId,
          taskId: task.taskId,
          taskType: task.type,
          environment,
          count: t.count,
          expectedScope: task.resources,
          skipTaskProfile: true,
          ...(input.modelId ? { modelId: input.modelId } : {}),
          reason: task.title,
        },
        { record: "real", approvals: false, alerts: true },
      );
      if (
        !worst ||
        effectRank(d.effect) > effectRank(worst.effect) ||
        (d.effect === worst.effect &&
          riskRank(d.risk.level) > riskRank(worst.risk.level))
      )
        worst = d;
    }
    const decision = worst!;
    return {
      effect: decision.effect,
      decision,
      summary: {
        effect: decision.effect,
        risk: decision.risk.level,
        environment: decision.environment,
        resource: decision.resource.label,
        summary: decision.explanation,
        reasons: decision.reasons.slice(0, 12),
        policies: decision.policies.map((p) => p.name),
        reversibility: decision.risk.reversible
          ? "Reversible"
          : "Not reversible",
        impact:
          decision.risk.blastRadius === "LOW"
            ? "Limited to the named resource."
            : `Blast radius ${decision.risk.blastRadius}.`,
      },
    };
  }

  halted(): boolean {
    return this.d.emergency.halted();
  }

  /* ---------------------------------------------------------------- */
  /* Post-execution                                                     */
  /* ---------------------------------------------------------------- */

  postCheck(input: {
    session: Pick<
      RuntimeSession,
      "executionId" | "changes" | "projectId" | "agentId" | "taskId"
    >;
    expected: readonly string[];
    keywords?: readonly string[];
  }): DriftReport {
    const norm = (s: string) =>
      s
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/^file:/, "")
        .toLowerCase();
    const stem = (s: string) => norm(s).replace(/\.[a-z0-9]+$/, "");
    const expected = input.expected.map(norm);
    const words = (input.keywords ?? [])
      .map((k) => k.toLowerCase())
      .filter((k) => k.length >= 4);
    const actual = [
      ...new Set(
        input.session.changes.flatMap((c) => [
          c.path,
          ...(c.renamedFrom ? [c.renamedFrom] : []),
        ]),
      ),
    ];
    const unexpected: DriftReport["unexpected"] = [];
    for (const path of actual) {
      const p = norm(path);
      const base = p.split("/").pop() ?? p;
      const related =
        expected.some(
          (e) =>
            p === e ||
            p.startsWith(e.endsWith("/") ? e : `${e}/`) ||
            stem(p) === stem(e),
        ) || words.some((w) => base.includes(w));
      if (related) continue;
      const info = describeResource(path);
      unexpected.push({
        path,
        kind: info.kind,
        sensitive: SENSITIVE_KINDS.includes(info.kind),
      });
    }
    if (unexpected.length === 0)
      return {
        status: "NONE",
        expected: [...input.expected],
        actual,
        unexpected: [],
        severity: "INFO",
        route: "NONE",
      };
    const sensitive = unexpected.filter((u) => u.sensitive);
    const severity: AlertSeverity = sensitive.some(
      (u) => u.kind === "SECRET" || u.kind === "ENV_FILE",
    )
      ? "CRITICAL"
      : sensitive.length > 0
        ? "HIGH"
        : "MEDIUM";
    const report: DriftReport = {
      status: "DRIFT_DETECTED",
      expected: [...input.expected],
      actual,
      unexpected,
      severity,
      route: "REVIEW_REQUIRED",
    };
    this.d.ledger.record("execution.drift_detected", {
      actor: "security-governor",
      severity,
      projectId: input.session.projectId,
      agentId: input.session.agentId,
      taskId: input.session.taskId,
      executionId: input.session.executionId,
      result: "REVIEW_REQUIRED",
      detail: {
        unexpected: unexpected
          .map((u) => u.path)
          .join(", ")
          .slice(0, 280),
        sensitive: sensitive.length,
      },
    });
    this.d.alerts.raise({
      severity,
      source: "DRIFT",
      event: "execution_drift",
      description: `Execution drift: ${unexpected.length} change(s) outside the task scope${sensitive.length ? `, ${sensitive.length} sensitive` : ""}.`,
      projectId: input.session.projectId,
      agentId: input.session.agentId,
      taskId: input.session.taskId,
      executionId: input.session.executionId,
      evidence: {
        expected: input.expected.join(", "),
        unexpected: unexpected.map((u) => u.path).join(", "),
      },
      dedupeKey: `drift:${input.session.executionId}`,
    });
    this.d.annotateSession?.(input.session.executionId, {
      reviewRequired: unexpected.map((u) => `drift: ${u.path}`),
      drift: report,
    });
    return report;
  }

  /* ---------------------------------------------------------------- */
  /* Runtime gate (Layer 5)                                              */
  /* ---------------------------------------------------------------- */

  gate(): ActionGate {
    return {
      check: async (g: GateInput): Promise<GateVerdict> => {
        const d = this.check({
          projectId: g.projectId,
          action: g.action as ActionClass,
          resource: g.resource,
          agentId: g.agentId,
          executionId: g.executionId,
          taskId: g.taskId,
          ...(g.taskType ? { taskType: g.taskType } : {}),
          ...(g.modelId ? { modelId: g.modelId } : {}),
          toolId: g.toolId,
          ...(g.command ? { command: g.command } : {}),
          ...(g.content !== undefined ? { content: g.content } : {}),
          ...(g.count ? { count: g.count } : {}),
          ...(g.expectedScope ? { expectedScope: g.expectedScope } : {}),
          ...(g.environment
            ? { environment: g.environment as GovEnvironment }
            : {}),
        });
        return {
          effect: d.effect,
          risk: d.risk.level,
          reasons: d.reasons,
          explanation: d.explanation,
          policies: d.policies.map((p) => p.name),
          ...(d.approval ? { approvalId: d.approval.approvalId } : {}),
        };
      },
      noteRefusal: (n) => {
        if (!n.agentId) return;
        const response = this.d.detector.ingest({
          at: Date.parse(this.d.clock()),
          agentId: n.agentId,
          projectId: n.projectId,
          ...(n.taskId ? { taskId: n.taskId } : {}),
          ...(n.executionId ? { executionId: n.executionId } : {}),
          kind: n.kind === "command" ? "BLOCKED_COMMAND" : "SCOPE_VIOLATION",
          resource: n.detail,
        });
        this.d.ledger.record("execution.blocked", {
          actor: n.agentId,
          severity: "MEDIUM",
          projectId: n.projectId,
          agentId: n.agentId,
          taskId: n.taskId,
          executionId: n.executionId,
          result: n.kind === "command" ? "BLOCKED_COMMAND" : "BLOCKED_PATH",
          detail: { detail: n.detail },
        });
        if (response.suspend)
          this.suspendAgent(
            response.suspend.agentId,
            "security-governor",
            response.suspend.reason,
          );
      },
    };
  }

  layers(): readonly string[] {
    return POLICY_LAYERS;
  }
}
