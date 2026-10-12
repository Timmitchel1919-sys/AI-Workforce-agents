/**
 * Security Foundation V1 — Layer 2
 *
 * Contracts for the Security Policy Engine. These are the authoritative
 * types that the deterministic evaluator in
 * `core/security/security-policy-engine.ts` consumes and emits. They
 * deliberately do NOT reference or extend the Governance Policy Engine
 * (`core/cost-center/governance-policy-engine.ts`): governance is about
 * cost, model/provider allow-lists and budget, while this layer is about
 * security risk, destructive actions, identity-security and
 * irreversible production impact. Both engines coexist in the request
 * pipeline; neither cancels the other.
 */
import type { Entity } from "./persistence.js";
export declare const SECURITY_RISK_LEVELS: readonly ["low", "medium", "high", "critical"];
export type SecurityRiskLevel = (typeof SECURITY_RISK_LEVELS)[number];
export declare const SECURITY_POLICY_EFFECTS: readonly ["allow", "deny", "require_approval"];
export type SecurityPolicyEffect = (typeof SECURITY_POLICY_EFFECTS)[number];
/**
 * Risk ranking used by the engine to compare and accumulate decisions.
 * The ordering is strict: `critical` > `high` > `medium` > `low`.
 */
export declare const SECURITY_RISK_RANK: Readonly<Record<SecurityRiskLevel, number>>;
/**
 * A single policy rule. Store these in a repository or seed them from
 * the default-policy loader. Arbitrary client-provided JSON must NEVER
 * become a `SecurityPolicy`: policy mutation requires the
 * `manage_security_policy` capability and passes through the engine
 * itself (no self-bypass).
 */
export interface SecurityPolicy extends Entity {
    id: string;
    name: string;
    enabled: boolean;
    /**
     * Shell-style action patterns the policy applies to. `*` matches any
     * run of characters that does not contain `.`. Patterns are matched
     * case-sensitively; absent / empty means the policy applies to every
     * action and other filters narrow it.
     */
    actionPatterns?: readonly string[];
    resourceTypes?: readonly string[];
    environments?: readonly string[];
    risk: SecurityRiskLevel;
    effect: SecurityPolicyEffect;
    requiresReauthentication?: boolean;
    requiresMfa?: boolean;
    requiresTwoPersonApproval?: boolean;
    /** Lower numbers evaluate first; ties break on more-specific action pattern. */
    priority: number;
    reason: string;
    createdAt: string;
    updatedAt: string;
}
/**
 * The context a caller passes to the engine. Fields are authoritative
 * and come from the trusted execution path, never from raw client body
 * — the API layer builds this from the verified operator principal,
 * the resolved project scope and the parsed request. Metadata is a
 * SMALL, redacted, non-secret bag; raw credentials MUST NOT appear.
 */
export interface SecurityActionContext {
    action: string;
    actorId: string;
    actorType: "human" | "agent" | "service" | "system" | "integration";
    role?: string;
    agentId?: string;
    projectId?: string;
    environment: "local" | "test" | "staging" | "production";
    targetResourceType: string;
    targetResourceId?: string;
    destructive: boolean;
    irreversible: boolean;
    production: boolean;
    requestedAt: string;
    correlationId: string;
    metadata?: Readonly<Record<string, unknown>>;
}
/**
 * The decision the engine returns. Combining decisions follows the
 * precedence rules documented on `SecurityPolicyEngine.evaluate`.
 */
export interface SecurityPolicyDecision {
    allowed: boolean;
    action: string;
    risk: SecurityRiskLevel;
    requiresApproval: boolean;
    requiresReauthentication: boolean;
    requiresMfa: boolean;
    requiresTwoPersonApproval: boolean;
    reason: string;
    matchedPolicyIds: readonly string[];
    recommendedAlternative?: string;
}
/**
 * A category of actions that are ALWAYS denied, regardless of role,
 * project, approval or any policy. Enforced by the engine before any
 * policy lookup. These are deliberately narrow invariants that no
 * normal workflow — including the Destructive Action Approval Gate —
 * may override. Retention / archival is a separate future lifecycle.
 */
export declare const PROHIBITED_ACTIONS: readonly ["audit.delete", "audit.purge", "audit.history.delete", "security_event.delete", "security_event.purge", "security_event.history.delete", "secret.export.raw", "secret.read.raw", "security_policy.bypass"];
export type ProhibitedAction = (typeof PROHIBITED_ACTIONS)[number];
/**
 * Action patterns the engine recognizes as INHERENTLY destructive. The
 * engine escalates risk and requires approval even if no explicit
 * `SecurityPolicy` matched — this is the fail-closed path for unknown
 * sensitive actions. Not an exhaustive list.
 */
export declare const DESTRUCTIVE_ACTION_PREFIXES: readonly ["delete.", "destroy.", "purge.", "revoke.", "terminate.", "drop.", "permanent.", "wipe."];
export declare function compareRisk(a: SecurityRiskLevel, b: SecurityRiskLevel): number;
export declare function maxRisk(a: SecurityRiskLevel, b: SecurityRiskLevel): SecurityRiskLevel;
export declare function isProhibitedAction(action: string): boolean;
export declare function isInherentlyDestructive(action: string): boolean;
