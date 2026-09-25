/**
 * Execution policy registry + evaluation (EO-4.1). DENY UNLESS PERMITTED.
 *
 * Policies are immutable and versioned: `(policyId, version)` is registered
 * once and can never be replaced, so a receipt's policy reference always
 * identifies the exact rules that governed it. A project is bound to a
 * `(policyId, version)`; an unbound project falls back to the configured
 * default policy (which, in production, permits nothing).
 */
import {
  ValidationError,
  riskAtLeast,
  tightenLimits,
  validateExecutionPolicy,
  type ExecutionCapability,
  type ExecutionOperationDefinition,
  type ExecutionPolicy,
  type ExecutionPolicyRule,
  type ExecutionReason,
  type ExecutionResourceLimits,
  type FilesystemScope,
  type NetworkPolicy,
  type SecretReference,
} from "../../contracts/index.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry);
    }
  }
  return value;
}

export class ExecutionPolicyRegistry {
  private readonly policies = new Map<string, ExecutionPolicy>();
  private readonly bindings = new Map<
    string,
    { policyId: string; version: number }
  >();

  constructor(
    private readonly fallback: { policyId: string; version: number },
  ) {}

  /** Register an immutable policy version. Re-registering a version throws. */
  register(policy: ExecutionPolicy): ExecutionPolicy {
    validateExecutionPolicy(policy);
    const key = `${policy.policyId}@${policy.version}`;
    if (this.policies.has(key)) {
      throw new ValidationError(
        `policy ${key} is already registered (immutable)`,
      );
    }
    const frozen = deepFreeze(structuredClone(policy));
    this.policies.set(key, frozen);
    return frozen;
  }

  get(policyId: string, version: number): ExecutionPolicy | undefined {
    return this.policies.get(`${policyId}@${version}`);
  }

  /** Bind a project to an exact registered policy version. */
  bindProject(projectId: string, policyId: string, version: number): void {
    if (!this.get(policyId, version)) {
      throw new ValidationError(`unknown policy ${policyId}@${version}`);
    }
    this.bindings.set(projectId, { policyId, version });
  }

  /** The policy governing a project, or undefined (→ deny). */
  forProject(projectId: string): ExecutionPolicy | undefined {
    const ref = this.bindings.get(projectId) ?? this.fallback;
    return this.get(ref.policyId, ref.version);
  }
}

export interface PolicyEvaluation {
  allowed: boolean;
  reasons: ExecutionReason[];
  rule?: ExecutionPolicyRule;
  capabilities: ExecutionCapability[];
  limits: ExecutionResourceLimits;
  network: NetworkPolicy;
  filesystem: readonly FilesystemScope[];
  secretRefs: readonly SecretReference[];
  requiresApproval: boolean;
}

/**
 * Evaluate one registered operation against a policy. Exact matching only:
 * no wildcards, no capability implication (build ⇏ deploy, write ⇏ push).
 */
export function evaluatePolicy(
  policy: ExecutionPolicy,
  operation: ExecutionOperationDefinition,
): PolicyEvaluation {
  const reasons: ExecutionReason[] = [];
  const forbidden = operation.requiredCapabilities.filter((c) =>
    policy.forbiddenCapabilities.includes(c),
  );
  if (forbidden.length > 0) {
    reasons.push({
      code: "POLICY_DENIED",
      detail: `capability explicitly forbidden: ${forbidden.join(", ")}`,
    });
  }
  if (!riskAtLeast(policy.maxRisk, operation.risk)) {
    reasons.push({
      code: "POLICY_DENIED",
      detail: `operation risk ${operation.risk} exceeds policy maximum ${policy.maxRisk}`,
    });
  }
  const rule = policy.rules.find(
    (r) =>
      r.operationIds.includes(operation.id) &&
      operation.requiredCapabilities.every((c) => r.capabilities.includes(c)),
  );
  if (!rule) {
    const listed = policy.rules.some((r) =>
      r.operationIds.includes(operation.id),
    );
    reasons.push({
      code: "POLICY_DENIED",
      detail: listed
        ? "no policy rule grants every capability this operation requires"
        : "no policy rule permits this operation (deny by default)",
    });
  }
  const limits = tightenLimits(policy.defaultLimits, rule?.limits);
  return {
    allowed: reasons.length === 0,
    reasons,
    ...(rule ? { rule } : {}),
    capabilities:
      reasons.length === 0
        ? [
            ...operation.requiredCapabilities,
            // Optional capabilities: only what the rule grants and no forbid.
            ...(operation.optionalCapabilities ?? []).filter(
              (c) =>
                rule!.capabilities.includes(c) &&
                !policy.forbiddenCapabilities.includes(c) &&
                !operation.requiredCapabilities.includes(c),
            ),
          ]
        : [],
    limits,
    network: rule?.network ?? policy.network,
    filesystem: rule?.filesystem ?? [],
    secretRefs: rule?.secretRefs ?? [],
    requiresApproval: riskAtLeast(
      operation.risk,
      policy.approvalRequiredAtOrAbove,
    ),
  };
}

/**
 * The production baseline: a real, versioned policy that permits nothing.
 * Execution is enabled per project only by registering and binding an
 * explicit policy version.
 */
export const BASELINE_DENY_ALL_POLICY: ExecutionPolicy = {
  policyId: "baseline-deny-all",
  version: 1,
  description:
    "EO-4.1 baseline: no operation is permitted until an explicit policy version is bound to the project.",
  rules: [],
  forbiddenCapabilities: ["deploy.invoke", "repository.push"],
  maxRisk: "low",
  approvalRequiredAtOrAbove: "low",
  defaultLimits: {
    sessionTimeoutMs: 15 * 60 * 1000,
    operationTimeoutMs: 5 * 60 * 1000,
    maxOutputBytes: 1024 * 1024,
    maxArtifactBytes: 256 * 1024 * 1024,
    maxToolCalls: 25,
  },
  network: { mode: "deny_all" },
  grantTtlMs: 15 * 60 * 1000,
};
