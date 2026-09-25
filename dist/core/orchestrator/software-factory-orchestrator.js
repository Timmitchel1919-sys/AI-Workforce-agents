import { NotFoundError, ValidationError, requireText, } from "../../contracts/index.js";
import { now } from "../shared.js";
/**
 * Validates that a list of tasks and their dependencies form a Directed Acyclic
 * Graph. Throws a `ValidationError` when a cycle is detected. Unknown
 * dependency ids are tolerated here — addTask validates them against the
 * workstream before this runs.
 */
function ensureDAG(tasks) {
    const adjacencyList = new Map();
    for (const task of tasks) {
        for (const depId of task.dependencies ?? []) {
            const edges = adjacencyList.get(depId) ?? [];
            edges.push(task.id);
            adjacencyList.set(depId, edges);
        }
        if (!adjacencyList.has(task.id))
            adjacencyList.set(task.id, []);
    }
    const visited = new Set();
    const recursionStack = new Set();
    function dfs(nodeId) {
        visited.add(nodeId);
        recursionStack.add(nodeId);
        for (const neighborId of adjacencyList.get(nodeId) ?? []) {
            if (!visited.has(neighborId)) {
                if (dfs(neighborId))
                    return true;
            }
            else if (recursionStack.has(neighborId)) {
                return true; // Cycle detected
            }
        }
        recursionStack.delete(nodeId);
        return false;
    }
    for (const nodeId of adjacencyList.keys()) {
        if (!visited.has(nodeId) && dfs(nodeId)) {
            throw new ValidationError("cycle detected in workstream task dependencies");
        }
    }
}
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
export class SoftwareFactoryOrchestrator {
    orchestrator;
    taskSystem;
    environments;
    programs = new Map();
    workstreams = new Map();
    /** Maps a retired planned-task id to the id the Orchestrator actually ran. */
    executionAliases = new Map();
    constructor(orchestrator, taskSystem, environments) {
        this.orchestrator = orchestrator;
        this.taskSystem = taskSystem;
        this.environments = environments;
    }
    createProgram(id, name, objective) {
        requireText(id, "program.id");
        requireText(name, "program.name");
        requireText(objective, "program.objective");
        const timestamp = now();
        const program = {
            id,
            name,
            objective,
            status: "active",
            workstreams: [],
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        this.programs.set(id, program);
        return program;
    }
    createWorkstream(programId, id, name, objective) {
        requireText(programId, "workstream.programId");
        requireText(id, "workstream.id");
        requireText(name, "workstream.name");
        requireText(objective, "workstream.objective");
        const program = this.programs.get(programId);
        if (!program)
            throw new NotFoundError(`unknown program: ${programId}`);
        const timestamp = now();
        const workstream = {
            id,
            programId,
            name,
            objective,
            status: "active",
            tasks: [],
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        this.workstreams.set(id, workstream);
        program.workstreams.push(id);
        program.updatedAt = timestamp;
        return workstream;
    }
    addTask(workstreamId, taskDraft) {
        const workstream = this.workstreams.get(workstreamId);
        if (!workstream)
            throw new NotFoundError(`unknown workstream: ${workstreamId}`);
        const members = new Set(workstream.tasks);
        for (const depId of taskDraft.dependencies ?? []) {
            const resolved = this.resolveTaskId(depId);
            if (!members.has(depId) && !members.has(resolved)) {
                throw new ValidationError(`task dependency "${depId}" is not a task in workstream "${workstreamId}"`);
            }
            if (!this.taskSystem.get(resolved)) {
                throw new ValidationError(`task dependency "${depId}" does not refer to an existing task`);
            }
        }
        const draft = {
            ...taskDraft,
            programId: workstream.programId,
            workstreamId: workstream.id,
            dependencies: taskDraft.dependencies ?? [],
        };
        const task = this.taskSystem.create(draft);
        // Re-validate the DAG over EVERY task in the workstream, including the new
        // one. A cycle must not leave the task persisted in the workstream — roll
        // the just-created placeholder back out of the shared store.
        const allTasks = [
            ...workstream.tasks.map((id) => this.taskSystem.require(id)),
            task,
        ];
        try {
            ensureDAG(allTasks);
        }
        catch (error) {
            this.taskSystem.delete(task.id);
            throw error;
        }
        workstream.tasks.push(task.id);
        workstream.updatedAt = now();
        return task;
    }
    /**
     * Advance every ACTIVE workstream by one deterministic step. Ready tasks
     * (dependencies `completed`, environment gate passed) are re-submitted to the
     * governed `Orchestrator` — its permission checks, approval gates and audit
     * events all still apply. A task that the Orchestrator created under a new id
     * is reconciled: the planned placeholder is retired and downstream edges
     * follow the executed id.
     */
    async tick() {
        for (const workstream of this.workstreams.values()) {
            if (workstream.status !== "active")
                continue;
            for (const taskId of [...workstream.tasks]) {
                const task = this.taskSystem.get(taskId);
                if (!task || task.status !== "created")
                    continue;
                if (!this.dependenciesMet(task))
                    continue;
                if (!this.environmentGateAllows(task))
                    continue;
                const submitted = await this.orchestrator.submit(this.toSubmitDraft(task));
                if (submitted.id !== task.id) {
                    this.executionAliases.set(task.id, submitted.id);
                    const index = workstream.tasks.indexOf(task.id);
                    if (index !== -1) {
                        workstream.tasks[index] = submitted.id;
                    }
                    this.taskSystem.delete(task.id);
                    workstream.updatedAt = now();
                }
            }
        }
    }
    overview() {
        const programs = [...this.programs.values()].map((program) => {
            let taskCount = 0;
            let activeTaskCount = 0;
            for (const wsId of program.workstreams) {
                const ws = this.workstreams.get(wsId);
                if (!ws)
                    continue;
                taskCount += ws.tasks.length;
                for (const taskId of ws.tasks) {
                    const task = this.taskSystem.get(taskId);
                    if (!task)
                        continue;
                    if (task.status !== "completed" &&
                        task.status !== "cancelled" &&
                        task.status !== "failed") {
                        activeTaskCount += 1;
                    }
                }
            }
            return {
                id: program.id,
                name: program.name,
                objective: program.objective,
                status: program.status,
                workstreamIds: [...program.workstreams],
                taskCount,
                activeTaskCount,
                updatedAt: program.updatedAt,
            };
        });
        return { programs };
    }
    programDetail(id) {
        const program = this.programs.get(id);
        if (!program)
            return undefined;
        const workstreams = this.programWorkstreams(program.id);
        return {
            program,
            workstreams,
            graph: this.graphFor(workstreams),
            routes: this.routesFor(workstreams),
        };
    }
    getGraphProjection(programId) {
        const program = this.programs.get(programId);
        if (!program)
            throw new NotFoundError(`unknown program: ${programId}`);
        return this.graphFor(this.programWorkstreams(program.id));
    }
    /* -------------------------------------------------------------- */
    /* internals                                                       */
    /* -------------------------------------------------------------- */
    programWorkstreams(programId) {
        const program = this.programs.get(programId);
        if (!program)
            return [];
        return program.workstreams
            .map((wsId) => this.workstreams.get(wsId))
            .filter((ws) => ws !== undefined);
    }
    graphFor(workstreams) {
        const nodes = [];
        const edges = [];
        for (const ws of workstreams) {
            for (const taskId of ws.tasks) {
                const task = this.taskSystem.get(taskId);
                if (!task)
                    continue;
                nodes.push({ id: task.id, task, status: task.status });
                for (const depId of task.dependencies ?? []) {
                    edges.push({
                        from: this.resolveTaskId(depId),
                        to: task.id,
                        type: "blocking",
                    });
                }
            }
        }
        return { nodes, edges };
    }
    /**
     * Redacted routing summary per task — never the full `EnvironmentCodeRoute`.
     * Tasks without declared environment requirements are `skipped`.
     */
    routesFor(workstreams) {
        const routes = [];
        for (const ws of workstreams) {
            for (const taskId of ws.tasks) {
                const task = this.taskSystem.get(taskId);
                if (!task)
                    continue;
                const codes = task.environmentRequirements ?? [];
                if (codes.length === 0) {
                    routes.push({
                        taskId: task.id,
                        code: "none",
                        status: "skipped",
                        detail: "no environment requirements declared",
                    });
                    continue;
                }
                for (const route of this.environments.route(codes)) {
                    routes.push({
                        taskId: task.id,
                        code: route.code,
                        status: routingStatus(route),
                        detail: routingDetail(route),
                    });
                }
            }
        }
        return routes;
    }
    dependenciesMet(task) {
        return (task.dependencies ?? []).every((depId) => {
            const dep = this.taskSystem.get(this.resolveTaskId(depId));
            return dep !== undefined && dep.status === "completed";
        });
    }
    /**
     * Environment gate (EO-5.1). A task with no declared requirements is always
     * eligible. Declared codes must all RESOLVE: the literal code `"none"`, or a
     * `ROUTED` outcome, releases the task. Anything else (provisioning required,
     * no instance, unsupported) blocks it — the task stays `created` and the
     * routing detail surfaces through `programDetail().routes`.
     */
    environmentGateAllows(task) {
        const codes = task.environmentRequirements ?? [];
        if (codes.length === 0)
            return true;
        return this.environments
            .route(codes)
            .every((route) => route.code === "none" || route.outcome.outcome === "ROUTED");
    }
    /**
     * Rebuild a `TaskDraft` from a stored task so the governed `Orchestrator`
     * re-applies permissions, approval policy and audit on dispatch. Dependency
     * ids are resolved to their executed counterparts first.
     */
    toSubmitDraft(task) {
        return {
            type: task.type,
            description: task.description,
            projectId: task.projectId,
            input: task.input,
            priority: task.priority,
            requiredPermissions: task.requiredPermissions,
            metadata: { ...task.metadata },
            programId: task.programId,
            workstreamId: task.workstreamId,
            objective: task.objective,
            requirements: task.requirements,
            dependencies: (task.dependencies ?? []).map((depId) => this.resolveTaskId(depId)),
            requiredCapabilities: task.requiredCapabilities,
            environmentRequirements: task.environmentRequirements,
            modelRequirements: task.modelRequirements,
            completionCriteria: task.completionCriteria,
            riskClass: task.riskClass,
        };
    }
    /** Map a retired planned id to the id the Orchestrator actually ran. */
    resolveTaskId(id) {
        return this.executionAliases.get(id) ?? id;
    }
}
function routingStatus(route) {
    switch (route.outcome.outcome) {
        case "ROUTED":
            return "routed";
        case "REQUIRES_PROVISIONING":
            return "requires_provisioning";
        case "NO_AVAILABLE_ENVIRONMENT":
            return "no_environment";
        case "UNSUPPORTED":
            return "unsupported";
    }
}
function routingDetail(route) {
    switch (route.outcome.outcome) {
        case "ROUTED":
            return `routed to ${route.outcome.instance.id} (host ${route.outcome.host.hostId})`;
        case "REQUIRES_PROVISIONING":
            return route.outcome.reason;
        case "NO_AVAILABLE_ENVIRONMENT":
            return route.outcome.reason;
        case "UNSUPPORTED":
            return route.outcome.reason;
    }
}
