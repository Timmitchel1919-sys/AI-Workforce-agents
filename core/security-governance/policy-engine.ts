/**
 * Policy Engine — one place where policy is evaluated.
 *
 * Precedence is by LAYER (system security → project security → architecture →
 * workflow → task → agent → user request) and then priority. Effects merge by
 * restrictiveness: a lower layer can only ADD restrictions; nothing weakens a
 * higher-layer restriction, and an ALLOW policy never relaxes anything (so
 * custom policies must restrict). Built-in system policies are immutable.
 */
import {
  POLICY_EFFECTS,
  POLICY_LAYERS,
  type ActionRequest,
  type GovPolicy,
  type MatchedPolicy,
  type PolicyCondition,
  type PolicyEffect,
  type ResourceInfo,
  type RiskAssessment,
  type TrustState,
} from "../../contracts/security-governance.js";
import { dataClassRank } from "./resources.js";
import { riskRank } from "./risk-engine.js";

export const effectRank = (e: PolicyEffect): number =>
  POLICY_EFFECTS.indexOf(e);
const layerRank = (l: GovPolicy["layer"]): number => POLICY_LAYERS.indexOf(l);

export interface EvalContext {
  request: ActionRequest;
  resource: ResourceInfo;
  environment: NonNullable<ActionRequest["environment"]>;
  risk: RiskAssessment;
  agentTrust?: TrustState;
  contentHasSecret: boolean;
  dataClass: NonNullable<ActionRequest["dataClass"]>;
  count: number;
}

export function matches(p: GovPolicy, ctx: EvalContext): boolean {
  if (p.status !== "ENABLED") return false;
  const s = p.scope;
  const r = ctx.request;
  if (s.projectId && s.projectId !== r.projectId) return false;
  if (s.workflowId && s.workflowId !== r.workflowId) return false;
  if (s.agentId && s.agentId !== r.agentId) return false;
  if (s.taskType && s.taskType !== r.taskType) return false;
  const c: PolicyCondition = p.conditions;
  if (c.actions && !c.actions.includes(r.action)) return false;
  if (c.resourceKinds && !c.resourceKinds.includes(ctx.resource.kind))
    return false;
  if (c.resourceIncludes) {
    const hay = `${ctx.resource.ref} ${ctx.resource.path ?? ""}`.toLowerCase();
    if (!c.resourceIncludes.some((x) => hay.includes(x.toLowerCase())))
      return false;
  }
  if (c.environments && !c.environments.includes(ctx.environment)) return false;
  if (c.minRisk && riskRank(ctx.risk.level) < riskRank(c.minRisk)) return false;
  if (c.minCount !== undefined && ctx.count < c.minCount) return false;
  if (c.dataClasses && !c.dataClasses.includes(ctx.dataClass)) return false;
  if (
    c.agentTrust &&
    (!ctx.agentTrust || !c.agentTrust.includes(ctx.agentTrust))
  )
    return false;
  if (
    c.contentHasSecret !== undefined &&
    c.contentHasSecret !== ctx.contentHasSecret
  )
    return false;
  return true;
}

const at = "1970-01-01T00:00:00.000Z";
const sys = (
  policyId: string,
  name: string,
  description: string,
  conditions: PolicyCondition,
  effect: PolicyEffect,
  extra: Partial<GovPolicy> = {},
): GovPolicy => ({
  id: policyId,
  policyId,
  name,
  description,
  layer: "SYSTEM_SECURITY",
  priority: 100,
  scope: {},
  conditions,
  effect,
  status: "ENABLED",
  builtin: true,
  critical: true,
  version: 1,
  createdAt: at,
  updatedAt: at,
  updatedBy: "system",
  ...extra,
});

const DESTRUCTIBLE = [
  "PROJECT",
  "REPOSITORY",
  "AGENT",
  "WORKFLOW",
  "INTEGRATION",
  "ENVIRONMENT",
  "SECRET",
  "DATABASE",
  "INFRASTRUCTURE",
  "FIREBASE_PROJECT",
  "POLICY",
] as const;

/** The system security policies. They cannot be edited, disabled or deleted. */
export const BUILTIN_POLICIES: readonly GovPolicy[] = Object.freeze([
  sys(
    "sys.secrets.no_access",
    "Secrets are never read or shared by agents",
    "Reading, exporting or sharing secrets and environment files is denied.",
    {
      actions: ["READ", "EXPORT", "SHARE", "ANALYZE"],
      resourceKinds: ["SECRET", "ENV_FILE"],
    },
    "DENY",
    { priority: 10 },
  ),
  sys(
    "sys.secrets.no_write",
    "Credentials are never written into files or outputs",
    "Content that contains a credential cannot be created or updated.",
    {
      actions: ["CREATE", "UPDATE", "PUBLISH", "EXPORT", "SHARE"],
      contentHasSecret: true,
    },
    "DENY",
    { priority: 11 },
  ),
  sys(
    "sys.firebase.no_prod_delete",
    "Production Firebase projects are never deleted automatically",
    "Deleting or administering a production Firebase project is denied.",
    {
      actions: ["DELETE", "ADMINISTRATIVE"],
      resourceKinds: ["FIREBASE_PROJECT"],
      environments: ["PRODUCTION"],
    },
    "DENY",
    { priority: 12 },
  ),
  sys(
    "sys.production.deploy",
    "Production Deployment Policy",
    "Publishing or deploying to production requires explicit human approval.",
    { actions: ["DEPLOY", "PUBLISH"], environments: ["PRODUCTION"] },
    "REQUIRE_APPROVAL",
    { priority: 20, approvalRequirement: "EXPLICIT_HUMAN" },
  ),
  sys(
    "sys.production.infrastructure",
    "Production infrastructure changes",
    "Any change to production infrastructure requires explicit human approval.",
    {
      actions: ["CREATE", "UPDATE", "DELETE", "EXECUTE", "ADMINISTRATIVE"],
      resourceKinds: ["INFRASTRUCTURE"],
      environments: ["PRODUCTION"],
    },
    "REQUIRE_APPROVAL",
    { priority: 21, approvalRequirement: "EXPLICIT_HUMAN" },
  ),
  sys(
    "sys.security_rules",
    "Security rules changes need a security review",
    "Changing security rules requires a security review; in production also explicit approval.",
    {
      actions: ["CREATE", "UPDATE", "DELETE"],
      resourceKinds: ["SECURITY_RULES"],
    },
    "REQUIRE_SECURITY_REVIEW",
    { priority: 30, securityRequirement: "SECURITY_REVIEW" },
  ),
  sys(
    "sys.security_rules.prod",
    "Production security rules changes",
    "Changing production security rules requires explicit human approval.",
    {
      actions: ["CREATE", "UPDATE", "DELETE"],
      resourceKinds: ["SECURITY_RULES"],
      environments: ["PRODUCTION"],
    },
    "REQUIRE_APPROVAL",
    { priority: 31, approvalRequirement: "EXPLICIT_HUMAN" },
  ),
  sys(
    "sys.destructive_gate",
    "Destructive Action Gate",
    "Deleting a project, repository, agent, workflow, integration, environment, secret or database requires explicit human approval.",
    { actions: ["DELETE"], resourceKinds: [...DESTRUCTIBLE] },
    "REQUIRE_APPROVAL",
    { priority: 40, approvalRequirement: "EXPLICIT_HUMAN" },
  ),
  sys(
    "sys.bulk",
    "Bulk Action Protection",
    "Operations touching a thousand or more resources require explicit human approval.",
    {
      actions: ["CREATE", "UPDATE", "DELETE", "EXECUTE", "PUBLISH"],
      minCount: 1000,
    },
    "REQUIRE_APPROVAL",
    { priority: 41, approvalRequirement: "EXPLICIT_HUMAN" },
  ),
  sys(
    "sys.auth_code",
    "Authentication code changes need review",
    "Changing authentication or authorization code requires an independent review.",
    { actions: ["CREATE", "UPDATE", "DELETE"], resourceKinds: ["AUTH_CODE"] },
    "REQUIRE_REVIEW",
    { priority: 50, securityRequirement: "REVIEW" },
  ),
  sys(
    "sys.ci_config",
    "CI/CD and deployment configuration changes need review",
    "Changing pipelines or deployment configuration requires an independent review.",
    {
      actions: ["CREATE", "UPDATE", "DELETE"],
      resourceKinds: ["CI_CONFIG", "DEPLOY_CONFIG"],
    },
    "REQUIRE_REVIEW",
    { priority: 51, securityRequirement: "REVIEW" },
  ),
  sys(
    "sys.external_data",
    "Restricted data never leaves the boundary",
    "Restricted or secret data cannot be exported or shared externally.",
    { actions: ["EXPORT", "SHARE"], dataClasses: ["RESTRICTED", "SECRET"] },
    "DENY",
    { priority: 60 },
  ),
  sys(
    "sys.external_confidential",
    "Confidential data export needs approval",
    "Exporting or sharing confidential data requires human approval.",
    { actions: ["EXPORT", "SHARE"], dataClasses: ["CONFIDENTIAL"] },
    "REQUIRE_APPROVAL",
    { priority: 61, approvalRequirement: "HUMAN" },
  ),
  sys(
    "sys.policy_admin",
    "Policies are changed by people, not agents",
    "Administrative changes to policies or trust are denied for agents.",
    {
      actions: ["ADMINISTRATIVE", "UPDATE", "DELETE", "CREATE"],
      resourceKinds: ["POLICY", "AGENT"],
    },
    "DENY",
    { priority: 70 },
  ),
]);

export interface PolicyResolution {
  effect: PolicyEffect;
  matched: MatchedPolicy[];
  overruled: MatchedPolicy[];
  obligations: { approval: boolean; review: boolean; securityReview: boolean };
  winner?: MatchedPolicy;
}

export function resolvePolicies(
  all: readonly GovPolicy[],
  ctx: EvalContext,
): PolicyResolution {
  const hit = all
    .filter((p) => matches(p, ctx))
    .sort(
      (a, b) =>
        layerRank(a.layer) - layerRank(b.layer) ||
        a.priority - b.priority ||
        a.policyId.localeCompare(b.policyId),
    );
  const view = (p: GovPolicy): MatchedPolicy => ({
    policyId: p.policyId,
    name: p.name,
    layer: p.layer,
    effect: p.effect,
    builtin: p.builtin,
  });
  const matched = hit.map(view);
  let effect: PolicyEffect = "ALLOW";
  let winner: MatchedPolicy | undefined;
  const obligations = { approval: false, review: false, securityReview: false };
  for (const m of matched) {
    if (effectRank(m.effect) > effectRank(effect)) {
      effect = m.effect;
      winner = m;
    }
    if (m.effect === "REQUIRE_APPROVAL") obligations.approval = true;
    if (m.effect === "REQUIRE_REVIEW") obligations.review = true;
    if (m.effect === "REQUIRE_SECURITY_REVIEW")
      obligations.securityReview = true;
  }
  // The earliest (highest-layer) policy that asked for the winning effect is the one cited.
  if (winner) winner = matched.find((m) => m.effect === effect) ?? winner;
  const overruled = matched.filter(
    (m) => effectRank(m.effect) < effectRank(effect),
  );
  return {
    effect,
    matched,
    overruled,
    obligations,
    ...(winner ? { winner } : {}),
  };
}

/** Baseline effect from risk alone, before any policy: LOW/MEDIUM proceed, HIGH/CRITICAL gate. */
export function baselineEffect(
  risk: RiskAssessment,
  action: ActionRequest["action"],
): { effect: PolicyEffect; reason: string } {
  if (risk.level === "CRITICAL")
    return {
      effect: "REQUIRE_APPROVAL",
      reason: "CRITICAL risk always needs explicit human approval",
    };
  if (risk.level === "HIGH") {
    const writes = action === "CREATE" || action === "UPDATE";
    return writes
      ? {
          effect: "REQUIRE_REVIEW",
          reason: "HIGH-risk change needs an independent review",
        }
      : {
          effect: "REQUIRE_APPROVAL",
          reason: "HIGH-risk action needs human approval",
        };
  }
  return { effect: "ALLOW", reason: `${risk.level} risk` };
}

export function validateCustomPolicy(
  p: Partial<GovPolicy>,
): string | undefined {
  if (!p.name || p.name.trim().length < 3) return "a policy needs a name";
  if (!p.effect || !POLICY_EFFECTS.includes(p.effect))
    return "effect is invalid";
  if (p.effect === "ALLOW")
    return "a policy can only add restrictions: ALLOW cannot relax a higher-layer restriction";
  if (!p.layer || !POLICY_LAYERS.includes(p.layer)) return "layer is invalid";
  if (p.layer === "SYSTEM_SECURITY")
    return "SYSTEM_SECURITY policies are built in and cannot be created";
  const c = p.conditions ?? {};
  if (
    Object.keys(c).length === 0 &&
    !p.scope?.projectId &&
    !p.scope?.agentId &&
    !p.scope?.taskType &&
    !p.scope?.workflowId
  )
    return "a policy needs at least one condition or scope";
  if (
    c.minCount !== undefined &&
    (!Number.isFinite(c.minCount) || c.minCount < 1)
  )
    return "minCount is invalid";
  for (const x of c.resourceIncludes ?? [])
    if (typeof x !== "string" || x.length > 120)
      return "resourceIncludes is invalid";
  void dataClassRank;
  return undefined;
}
