/**
 * Execution policy registry + evaluation (EO-4.1). DENY UNLESS PERMITTED.
 *
 * Policies are immutable and versioned: `(policyId, version)` is registered
 * once and can never be replaced, so a receipt's policy reference always
 * identifies the exact rules that governed it. A project is bound to a
 * `(policyId, version)`; an unbound project falls back to the configured
 * default policy (which, in production, permits nothing).
 */
import { type ExecutionCapability, type ExecutionOperationDefinition, type ExecutionPolicy, type ExecutionPolicyRule, type ExecutionReason, type ExecutionResourceLimits, type FilesystemScope, type NetworkPolicy, type SecretReference } from "../../contracts/index.js";
export declare class ExecutionPolicyRegistry {
    private readonly fallback;
    private readonly policies;
    private readonly bindings;
    constructor(fallback: {
        policyId: string;
        version: number;
    });
    /** Register an immutable policy version. Re-registering a version throws. */
    register(policy: ExecutionPolicy): ExecutionPolicy;
    get(policyId: string, version: number): ExecutionPolicy | undefined;
    /** Bind a project to an exact registered policy version. */
    bindProject(projectId: string, policyId: string, version: number): void;
    /** The policy governing a project, or undefined (→ deny). */
    forProject(projectId: string): ExecutionPolicy | undefined;
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
export declare function evaluatePolicy(policy: ExecutionPolicy, operation: ExecutionOperationDefinition): PolicyEvaluation;
/**
 * The production baseline: a real, versioned policy that permits nothing.
 * Execution is enabled per project only by registering and binding an
 * explicit policy version.
 */
export declare const BASELINE_DENY_ALL_POLICY: ExecutionPolicy;
