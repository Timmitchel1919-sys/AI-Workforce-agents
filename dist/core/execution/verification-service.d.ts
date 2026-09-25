/**
 * EO-4.4 VerificationService — controlled build, test & verification.
 *
 *   BUILD/TEST EXECUTION IS BOUNDED · NO GENERAL-PURPOSE TERMINAL ·
 *   VERIFIED ≠ COMMITTED ≠ PUSHED ≠ DEPLOYED
 *
 * Runs the build, test and security stages an exact ExecutionPlan revision
 * already contains, through REGISTERED operations mapped by a trusted
 * per-project VerificationProfile. Every stage is its own ExecutionManager
 * session (pre-flight, policy, environment + toolchain revalidation, sandbox
 * selection, limits, receipts) — this service adds ordering, bounded
 * parallelism, fail-fast, bounded retries of TRANSIENT failures, source
 * fingerprinting, artifact integrity and an immutable result. It never
 * commits, pushes, merges or deploys, and deployment stages are never run.
 */
import { type OperatorPrincipal, type VerificationProfile, type VerificationResult, type WorkspaceControl } from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { EnvironmentRegistry } from "../environments/environment-registry.js";
import type { ExecutionPlanningService } from "../planning/execution-planning-service.js";
import type { ArtifactManager } from "./artifact-manager.js";
import type { ExecutionManager } from "./execution-manager.js";
import type { ExecutionOperationRegistry } from "./execution-operations.js";
import type { SandboxRegistry } from "./sandbox.js";
export interface VerificationServiceOptions {
    manager: Pick<ExecutionManager, "createSession" | "invoke" | "cancel" | "getSession" | "getChangeSet">;
    planning: Pick<ExecutionPlanningService, "get" | "latest">;
    operations: Pick<ExecutionOperationRegistry, "get">;
    environments: Pick<EnvironmentRegistry, "getInstance">;
    sandboxes: Pick<SandboxRegistry, "get">;
    projects: {
        has(projectId: string): boolean;
    };
    audit: AuditLog;
    artifacts: ArtifactManager;
    workspaceControl?: WorkspaceControl;
    /** Simultaneous verifications per project. Default 1. */
    maxConcurrentPerProject?: number;
    /** Bounded, redacted log excerpt kept per stage. Default 16 KiB. */
    maxLogBytes?: number;
    clock?: () => string;
    idFactory?: (prefix: string) => string;
}
export interface StartVerificationRequest {
    projectId: string;
    planId: string;
    planVersion: number;
    /** Completed developer session whose ChangeSet is being verified. */
    sourceSessionId?: string;
}
export declare class VerificationService {
    private readonly options;
    private readonly clock;
    private readonly newId;
    private readonly profiles;
    private readonly runs;
    private readonly byKey;
    constructor(options: VerificationServiceOptions);
    /** Trusted composition only — agents and the API cannot set profiles. */
    registerProfile(profile: VerificationProfile): void;
    private authorize;
    private record;
    /**
     * Validate and start a verification. Returns immediately with the pending
     * record; `wait(id)` resolves with the immutable terminal result. Structural
     * problems (unknown dependency, cycle, bad request) throw BEFORE anything
     * executes. Idempotent per `(operator, idempotencyKey)`.
     */
    start(principal: OperatorPrincipal, raw: unknown, idempotencyKey: string): Promise<VerificationResult>;
    private validateStart;
    /**
     * Stage DAG: plan dependencies + profile `dependsOn`. Unknown references
     * and cycles are refused before anything runs. Returns a deterministic
     * topological order (plan order breaks ties).
     */
    private validateGraph;
    private setStage;
    private stage;
    private run;
    private overallStatus;
    private finish;
    private runStage;
    private classify;
    private denialFailure;
    /** Secret-scan evidence: rule + count only (paths stay in the log). */
    private findings;
    private excerpt;
    /** Toolchains + isolation as reported by registries — never assumed. */
    private observeEnvironment;
    cancel(principal: OperatorPrincipal, verificationId: string, reason: string): Promise<VerificationResult>;
    get(principal: OperatorPrincipal, verificationId: string): VerificationResult;
    /** Resolves with the terminal, immutable result. */
    wait(principal: OperatorPrincipal, verificationId: string): Promise<VerificationResult>;
    /** Immutable history for one project, newest first. */
    history(principal: OperatorPrincipal, projectId: string): VerificationResult[];
    private scoped;
}
