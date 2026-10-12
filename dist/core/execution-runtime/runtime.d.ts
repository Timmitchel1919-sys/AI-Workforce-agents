/**
 * GovernedTaskRuntime (Layer 5) — implements the Layer 4 `TaskRuntimePort`.
 *
 *   Layer 4 task ─► session (CREATED → INITIALIZING → READY → RUNNING …)
 *     ─► explicit workspace resolution ─► project-isolation check
 *     ─► tool session (authorized tools only) ─► the work
 *     ─► structured result (+ evidence) back to Layer 4, which VERIFIES it.
 *
 * What the runtime does itself, deterministically: inspect, validate
 * (typecheck → lint → test → build), diff + scope checks, governed commit,
 * deployment hand-off. What needs judgement or code generation — authoring,
 * semantic review, security review — is delegated to an `AgentExecutorPort`
 * through the tool session; with none configured those tasks report an
 * honest "no agent executor" instead of pretending.
 */
import { type OrchTask } from "../../contracts/execution-orchestration.js";
import { type FileChange, type RuntimeSession, type ScopeReport, type ValidationStageResult } from "../../contracts/execution-runtime.js";
import type { RuntimeOutcome, TaskExecutionContext, TaskRuntimePort } from "../execution-orchestration/ports.js";
import { type GitOps } from "./git-ops.js";
import { type ProcessRunner } from "./process-runner.js";
import { type SessionManager } from "./session-manager.js";
import { AgentToolSession, type ActionGate, type CapabilityPort, extractErrors } from "./tools.js";
import { WorkspaceResolver, type ResolvedWorkspace } from "./workspace.js";
/** What an agent executor (the LLM loop) is given for one task. */
export interface AgentWork {
    task: OrchTask;
    context: TaskExecutionContext;
    tools: AgentToolSession;
    /** Mechanical facts the runtime computed (diff scope, validation so far). */
    facts: {
        /** Governance flags: changes that need an independent review (REQUIRE_REVIEW, drift). */
        reviewRequired?: readonly string[];
        scope: ScopeReport;
        changes: readonly FileChange[];
        validation: readonly ValidationStageResult[];
    };
}
export interface AgentExecutorPort {
    perform(work: AgentWork): Promise<RuntimeOutcome>;
}
/** Deployment is a hand-off to the deployment pipeline, never a shell command. */
export interface DeploymentHandoffPort {
    readonly available: boolean;
    handoff(input: {
        projectId: string;
        runId: string;
        taskId: string;
        branch?: string;
        commit?: string;
    }): Promise<{
        reference: string;
    }>;
}
export declare class UnavailableDeploymentHandoff implements DeploymentHandoffPort {
    readonly available = false;
    handoff(): Promise<never>;
}
export interface RuntimeDeps {
    resolver: Pick<WorkspaceResolver, "resolve">;
    manager: SessionManager;
    runner?: ProcessRunner;
    gitFactory?: (workspace: ResolvedWorkspace) => GitOps;
    agentExecutor?: AgentExecutorPort;
    deployment?: DeploymentHandoffPort;
    clock?: () => string;
    identity?: {
        name: string;
        email: string;
    };
    /** Cap on a single command, in milliseconds. */
    maxCommandMs?: number;
    /** Layer 8: the integration hub, exposed to agents as capabilities only. */
    capabilities?: CapabilityPort;
    /** Layer 7: policy decision point consulted before every write, delete, command, commit and deployment. */
    gate?: ActionGate;
    /** Called after every execution (success or failure): the learning loop's entry point. */
    onFinished?: (input: {
        session: RuntimeSession;
        task: OrchTask;
        context: TaskExecutionContext;
        outcome: RuntimeOutcome;
    }) => void | Promise<void>;
}
export declare class GovernedTaskRuntime implements TaskRuntimePort {
    private readonly deps;
    readonly id = "governed-local";
    private readonly clock;
    private readonly runner;
    private readonly identity;
    constructor(deps: RuntimeDeps);
    /** Layer 4 cancels a run: stop its live processes now, not after they finish. */
    cancelRun(runId: string): void;
    execute(task: OrchTask, context: TaskExecutionContext): Promise<RuntimeOutcome>;
    private executeInner;
    private perform;
    /** Read-only inspection: the tree, the relevant files and the declared scripts. */
    private inspect;
    private validationOutcome;
    private commit;
    private deploy;
    private delegateOrBlock;
    private delegate;
    private finish;
    private fail;
    private failure;
}
export { extractErrors };
