import { type GraphProjection, type SoftwareFactoryEnvironmentProvider, type SoftwareFactoryOverview, type SoftwareFactoryProgram, type SoftwareFactoryProgramDetail, type Task, type TaskDraft, type Workstream } from "../../contracts/index.js";
import type { TaskSystem } from "../tasks/task-system.js";
import type { Orchestrator } from "./orchestrator.js";
/**
 * EO-5.1 Software Factory orchestrator.
 *
 * Holds programs/workstreams in memory and plans tasks through the shared
 * `TaskSystem` (task status `created` until it is ready). `tick()` advances
 * every ACTIVE workstream: a `created` task whose declared dependencies are all
 * `completed` — and whose environment requirements route to a usable instance —
 * is dispatched through the standard governed `Orchestrator` (permissions,
 * approval gates, audit). There is NO execution bypass: a ready task never
 * transitions directly through `TaskSystem`; it always re-enters via
 * `Orchestrator.submit(draft)`. Deterministic, no timers; `tick()` is explicit.
 */
export declare class SoftwareFactoryOrchestrator {
    private readonly orchestrator;
    private readonly taskSystem;
    private readonly environments;
    private readonly programs;
    private readonly workstreams;
    /** Maps a retired planned-task id to the id the Orchestrator actually ran. */
    private readonly executionAliases;
    constructor(orchestrator: Orchestrator, taskSystem: TaskSystem, environments: SoftwareFactoryEnvironmentProvider);
    createProgram(id: string, name: string, objective: string): SoftwareFactoryProgram;
    createWorkstream(programId: string, id: string, name: string, objective: string): Workstream;
    addTask(workstreamId: string, taskDraft: TaskDraft): Task;
    /**
     * Advance every ACTIVE workstream by one deterministic step. Ready tasks
     * (dependencies `completed`, environment gate passed) are re-submitted to the
     * governed `Orchestrator` — its permission checks, approval gates and audit
     * events all still apply. A task that the Orchestrator created under a new id
     * is reconciled: the planned placeholder is retired and downstream edges
     * follow the executed id.
     */
    tick(): Promise<void>;
    overview(): SoftwareFactoryOverview;
    programDetail(id: string): SoftwareFactoryProgramDetail | undefined;
    getGraphProjection(programId: string): GraphProjection;
    private programWorkstreams;
    private graphFor;
    /**
     * Redacted routing summary per task — never the full `EnvironmentCodeRoute`.
     * Tasks without declared environment requirements are `skipped`.
     */
    private routesFor;
    private dependenciesMet;
    /**
     * Environment gate (EO-5.1). A task with no declared requirements is always
     * eligible. Declared codes must all RESOLVE: the literal code `"none"`, or a
     * `ROUTED` outcome, releases the task. Anything else (provisioning required,
     * no instance, unsupported) blocks it — the task stays `created` and the
     * routing detail surfaces through `programDetail().routes`.
     */
    private environmentGateAllows;
    /**
     * Rebuild a `TaskDraft` from a stored task so the governed `Orchestrator`
     * re-applies permissions, approval policy and audit on dispatch. Dependency
     * ids are resolved to their executed counterparts first.
     */
    private toSubmitDraft;
    /** Map a retired planned id to the id the Orchestrator actually ran. */
    private resolveTaskId;
}
