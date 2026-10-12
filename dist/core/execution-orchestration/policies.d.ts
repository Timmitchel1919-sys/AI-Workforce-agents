import type { FailureClass, OrchTask, OrchTaskType, RecoveryAction } from "../../contracts/execution-orchestration.js";
import type { ModelCapability } from "../../contracts/planning.js";
import type { RoutingProfile } from "../../contracts/routing.js";
export interface AgentCapabilityDefinition {
    /** Product-level capability name. */
    readonly id: string;
    /** Canonical taxonomy ids (contracts/capabilities.ts) it maps onto. */
    readonly taxonomy: readonly string[];
    readonly description: string;
    /** `v2` entries are declared for the future; no agent is implied. */
    readonly status: "v1" | "v2";
}
export declare const AGENT_CAPABILITY_REGISTRY: readonly AgentCapabilityDefinition[];
/** The product-level name(s) of a taxonomy capability (for display). */
export declare function productNamesFor(taxonomyId: string): string[];
/** Taxonomy ids for a product-level capability name; unknown → undefined. */
export declare function taxonomyFor(productId: string): readonly string[] | undefined;
/** Never granted to any agent through orchestration. */
export declare const ALWAYS_DENIED_TOOLS: readonly string[];
export declare const WRITE_TOOLS: ReadonlySet<string>;
export interface ToolAuthorization {
    permitted: string[];
    denied: string[];
    reasons: string[];
}
/**
 * Least privilege: the task type's allow-list, plus approval-gated tools only
 * when THIS task's human approval has been granted, minus anything an agent
 * profile forbids. Destructive tools additionally require `destructive`.
 */
export declare function authorizeTools(task: Pick<OrchTask, "type" | "destructive">, options: {
    approved: boolean;
    agentToolAccess?: "none" | "read_only" | "standard";
}): ToolAuthorization;
/** Does a task need any write tool to do its job? */
export declare function needsWriteTools(type: OrchTaskType, approvedGated: boolean): boolean;
/** Classify a failure message when the runtime did not say. */
export declare function classifyFailure(error: string, hint?: FailureClass): FailureClass;
export interface RecoveryContext {
    classification: FailureClass;
    attempts: number;
    maxAttempts: number;
    corrections: number;
    maxCorrections: number;
    isGate: boolean;
    hasCorrectionTarget: boolean;
    alternativeAgentAvailable: boolean;
}
/**
 * RETRY transient · CORRECT logical · BLOCK security · WAIT approval ·
 * REASSIGN when retries are spent but another qualified agent exists ·
 * ESCALATE when the limits are reached. Never retries indefinitely.
 */
export declare function decideRecovery(ctx: RecoveryContext): RecoveryAction;
/**
 * Higher runs first: explicit priority, then dependency criticality (how many
 * tasks wait on this one), risk (gates early), and earlier workflow position.
 */
export declare function queueScore(task: OrchTask, dependents: number, position: number): number;
export interface ModelNeed {
    requiredCapabilities: ModelCapability[];
    routingProfile: RoutingProfile;
    structuredOutput: boolean;
    /** Plain-language rationale recorded on the task. */
    rationale: string;
}
/** Deterministic, configurable-by-edit mapping from task shape to a model need. */
export declare function modelNeedFor(task: Pick<OrchTask, "type" | "risk" | "estimate">): ModelNeed;
/** Canonicalize a list of capability ids; throws on an unknown id. */
export declare function requireCanonical(ids: readonly string[]): string[];
