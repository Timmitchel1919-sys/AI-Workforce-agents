import type { ExecutionCapability } from "./execution.js";
import type { ModelPolicy } from "./index.js";
import type { Agent } from "./index.js";
/**
 * WHO the agent is allowed to be. This is the operator-controlled lifecycle
 * and is orthogonal to the operational state: an agent can be administratively
 * `active` while operationally `blocked`. `retired` is terminal and preserves
 * historical identity — an agent is never silently deleted, because past
 * executions must remain attributable to the definition that produced them.
 */
export declare const AGENT_ADMINISTRATIVE_STATUSES: readonly ["draft", "active", "suspended", "disabled", "retired"];
export type AgentAdministrativeStatus = (typeof AGENT_ADMINISTRATIVE_STATUSES)[number];
export declare function canTransitionAdministrative(from: AgentAdministrativeStatus, to: AgentAdministrativeStatus): boolean;
/**
 * May an agent in this administrative state receive NEW work?
 * `suspended`, `disabled` and `retired` may not. This is checked at the
 * assignment boundary, never inferred from a UI badge.
 */
export declare function acceptsNewAssignments(status: AgentAdministrativeStatus): boolean;
/**
 * WHAT the agent is doing right now. This is derived from authoritative task /
 * assignment / execution records — it is never set by a client and never
 * animated for effect. Operational state says nothing about authority: a
 * `busy` agent and an `available` agent have exactly the same policies.
 */
export declare const AGENT_INSTANCE_STATES: readonly ["available", "assigned", "busy", "waiting", "blocked", "offline"];
export type AgentInstanceState = (typeof AGENT_INSTANCE_STATES)[number];
export declare const AGENT_RISK_LEVELS: readonly ["low", "moderate", "high", "critical"];
export type AgentRiskLevel = (typeof AGENT_RISK_LEVELS)[number];
/** Is `actual` at or below the `ceiling`? A ceiling can never be exceeded. */
export declare function riskWithinCeiling(actual: AgentRiskLevel, ceiling: AgentRiskLevel): boolean;
/**
 * The highest execution capabilities this agent may EVER be granted.
 *
 * This is a CEILING, not a grant. `ExecutionManager` still decides the actual
 * per-session capability set, and a descriptor ceiling never bypasses the
 * permission system, approval gates or cost limits. An empty ceiling means the
 * agent is advisory: it may reason and report, and may not touch a workspace.
 */
export interface AgentToolPolicy {
    readonly maxExecutionCapabilities: readonly ExecutionCapability[];
    /** Capabilities that are refused even if a session would otherwise allow them. */
    readonly deniedExecutionCapabilities: readonly ExecutionCapability[];
    /** Always false for every V1 agent. There is no unrestricted shell authority. */
    readonly allowsUnrestrictedShell: boolean;
}
/** Deny-by-default project scoping. An empty list means "no project". */
export interface AgentProjectPolicy {
    readonly mode: "allow_list";
    readonly projects: readonly string[];
}
/** Environment needs are declared, never assumed from the role. */
export interface AgentEnvironmentRequirements {
    /** Empty + `acceptsAnyEnvironmentType: true` means "no environment needed". */
    readonly requiredEnvironmentTypes: readonly string[];
    readonly acceptsAnyEnvironmentType: boolean;
}
/**
 * Standing constraints checked by the qualification router for EVERY task.
 * A task that violates any of them yields NO_QUALIFIED_AGENT rather than a
 * nearest-match fallback.
 */
export interface AgentQualificationProfile {
    readonly technologies: readonly string[];
    readonly maxRiskLevel: AgentRiskLevel;
    /** Task requirements that mention any of these tools cannot be assigned here. */
    readonly requiredToolCapabilities: readonly ExecutionCapability[];
    /** Minimum risk level at which independent review becomes mandatory. */
    readonly reviewRequiredFromRiskLevel: AgentRiskLevel;
}
export interface AgentReviewPolicy {
    readonly requiresIndependentReview: boolean;
    readonly minimumReviewers: number;
    /** An agent may never review its own change set, at any risk level. */
    readonly selfReviewAllowed: false;
}
export interface AgentHandoffPolicy {
    /** Capabilities this agent may hand work to. Empty = no outgoing handoffs. */
    readonly canDelegateTo: readonly string[];
    /** When true the destination agent must explicitly accept before work moves. */
    readonly requiresDestinationAcceptance: boolean;
}
export interface AgentCostPolicy {
    readonly costCenter: string;
    /** `undefined` means "no per-execution ceiling declared", not "free". */
    readonly maxCostPerExecutionUsd?: number;
    /** Agent executions are always attributable to project + task + agent. */
    readonly attestsUsage: true;
}
export declare const MAX_AGENT_ID_LENGTH = 64;
export declare const MAX_AGENT_DEFINITIONS = 512;
export declare function isSafeIdentifier(value: unknown): value is string;
/**
 * A caller PRINCIPAL, not a resource identifier.
 *
 * Principals legitimately contain a `:` separator (`user:admin`,
 * `system:reassign`) and may be longer than an agent id, so they get their own
 * rule. The prototype-pollution guard is retained: `__proto__` is a legal
 * string in JavaScript and must never be accepted as a principal.
 */
export declare function isSafePrincipal(value: unknown): value is string;
/**
 * The authoritative static definition of a specialist agent.
 *
 * It holds NO runtime state: no current task, no busy flag, no progress. Those
 * belong to {@link AgentInstance} and {@link Assignment}.
 */
export interface AgentDescriptor extends Agent {
    readonly id: string;
    readonly name: string;
    readonly displayName: string;
    readonly role: string;
    readonly department: string;
    readonly description: string;
    readonly avatarUrl?: string;
    readonly costPerHour?: number;
    /** Canonical hierarchical capability ids (see `contracts/capabilities.ts`). */
    readonly capabilities: readonly string[];
    /** Stated in prose on purpose: the Control Center shows it verbatim. */
    readonly limitations: readonly string[];
    readonly administrativeStatus: AgentAdministrativeStatus;
    /** Monotonically increasing, starting at 1. */
    readonly version: number;
    /** Required: an agent with no model policy can never be routed to a model. */
    readonly modelPolicy: ModelPolicy;
    readonly qualification: AgentQualificationProfile;
    readonly environmentRequirements: AgentEnvironmentRequirements;
    readonly toolPolicy: AgentToolPolicy;
    readonly projectPolicy: AgentProjectPolicy;
    readonly riskProfile: AgentRiskLevel;
    readonly reviewPolicy: AgentReviewPolicy;
    readonly handoffPolicy: AgentHandoffPolicy;
    readonly costPolicy: AgentCostPolicy;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly metadata?: Record<string, unknown>;
}
/**
 * One operational instance of a descriptor.
 *
 * `descriptorId` + `descriptorVersion` pin the exact definition that produced
 * every execution attributed to this instance, so a later descriptor revision
 * never rewrites historical identity.
 */
export interface AgentInstance {
    readonly id: string;
    readonly descriptorId: string;
    readonly descriptorVersion: number;
    readonly operationalState: AgentInstanceState;
    readonly projectId?: string;
    readonly currentAssignmentId?: string;
    readonly currentTaskId?: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly metadata?: Record<string, unknown>;
}
/**
 * What a specialist is asked to do. Deliberately structured rather than a free
 * blob of conversation history: a handoff carries only the context relevant to
 * this task, never the previous agent's whole transcript.
 */
export interface SpecialistTask {
    objective: string;
    context: string[];
    instructions: string;
    acceptanceCriteria: string[];
}
export interface SpecialistResult {
    taskId: string;
    agentId: string;
    summary: string;
    output: Record<string, unknown>;
    createdAt: string;
}
export declare function validateSpecialistTask(raw: unknown): SpecialistTask;
export declare function validateSpecialistResult(raw: unknown): asserts raw is SpecialistResult;
/**
 * Full structural + policy validation of a descriptor.
 *
 * This is the gate that makes a descriptor *registerable*. It is deliberately
 * strict: an agent that cannot state its model policy, tool ceiling, project
 * policy and review policy is not a describable agent, and registering it
 * would produce an agent that is invisible to routing and unbounded at runtime.
 */
export declare function validateAgentDescriptor(descriptor: AgentDescriptor): void;
/** An operational instance must point at a real descriptor and a real state. */
export declare function validateAgentInstance(instance: AgentInstance): void;
