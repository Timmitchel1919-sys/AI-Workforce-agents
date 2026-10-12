import type { Repository } from "../../contracts/persistence.js";
import type { UsageDraft } from "../../contracts/cost-center.js";
import { type ActivityRecord, type HubRequest, type HubResult, type OperationClass } from "../../contracts/integration-gateway.js";
import type { SecuritySystem } from "../security-governance/index.js";
import type { McpGateway } from "./mcp.js";
import { HubRegistry } from "./registry.js";
import { RateLimiter, HealthMonitor } from "./resilience.js";
import { type FetchLike } from "./rest.js";
import { CredentialVault, OAuthManager } from "./vault.js";
export interface QueuedRequest {
    id: string;
    request: HubRequest;
    capability: string;
    connectorId: string;
    enqueuedAt: string;
    attempts: number;
    nextAttemptAt: string;
    status: "QUEUED" | "DONE" | "FAILED";
    lastError?: string;
}
/** Deployment is a hand-off: the gateway never builds or runs deploy commands itself. */
export interface DeploymentExecutor {
    readonly available: boolean;
    prepare(input: {
        projectId: string;
        environment: string;
        resource: string;
    }): Promise<{
        reference: string;
        summary: string;
    }>;
    execute(input: {
        projectId: string;
        environment: string;
        resource: string;
    }): Promise<{
        reference: string;
    }>;
}
export interface GatewayDeps {
    registry: HubRegistry;
    vault: CredentialVault;
    oauth: OAuthManager;
    security: SecuritySystem;
    health: HealthMonitor;
    limiter: RateLimiter;
    activity: Repository<ActivityRecord>;
    queue: Repository<QueuedRequest>;
    fetchImpl: FetchLike;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    deployment?: DeploymentExecutor;
    mcp?: McpGateway;
    recordUsage?: (draft: UsageDraft) => void;
    newId?: () => string;
}
export declare class ToolGateway {
    private readonly d;
    private readonly activity;
    private readonly queue;
    private readonly now;
    private readonly sleep;
    private readonly newId;
    constructor(d: GatewayDeps);
    private iso;
    /** What can be asked for in this project, and what each thing would require. */
    discover(projectId: string): {
        capability: string;
        description: string;
        operation: OperationClass;
        risk: string;
        providers: {
            connectorId: string;
            provider: string;
            status: string;
            mode: string;
            trust: string;
            resource: string;
            role: string;
        }[];
        approval: "none" | "likely" | "always";
        available: boolean;
        reason?: string;
    }[];
    invoke(req: HubRequest, internal?: {
        substitutedFrom?: string;
        fallbackFrom?: string;
        skipQueue?: boolean;
    }): Promise<HubResult>;
    private rejectReason;
    private resolveResource;
    private executeOnce;
    private noteCredentialFailure;
    private recordUsage;
    private enqueue;
    queued(): QueuedRequest[];
    /** Retry due queue entries. Each is re-evaluated by the full pipeline; nothing is replayed blindly. */
    drainQueue(max?: number): Promise<{
        attempted: number;
        done: number;
        failed: number;
        requeued: number;
    }>;
    private invokeMcp;
    activityLog(filter?: {
        projectId?: string;
        connectorId?: string;
        outcome?: string;
        limit?: number;
    }): ActivityRecord[];
    /** The secret-free view of a connection test: one cheap READ through the normal pipeline. */
    testConnection(connectorId: string, by: string): Promise<{
        ok: boolean;
        message: string;
        latencyMs: number;
    }>;
}
