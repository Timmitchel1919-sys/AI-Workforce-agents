import {
  NotFoundError,
  StateTransitionError,
  ValidationError,
  requireText,
  SOFTWARE_FACTORY_SCHEMA_VERSION,
  type AgentExecutionContext,
  type EnvironmentCodeRoute,
  type GraphEdge,
  type GraphNode,
  type GraphProjection,
  type ProgramSummary,
  type Repository,
  type SoftwareFactoryEnvironmentProvider,
  type SoftwareFactoryOverview,
  type SoftwareFactoryProgram,
  type SoftwareFactoryProgramDetail,
  type SoftwareFactoryTaskAlias,
  type SoftwareFactoryTaskInput,
  type SoftwareFactoryTaskView,
  type Task,
  type TaskDraft,
  type TaskEnvironmentRoutingSummary,
  type Workstream,
} from "../../contracts/index.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import type { TaskSystem } from "../tasks/task-system.js";
import { now } from "../shared.js";
import type { Orchestrator } from "./orchestrator.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PROGRAM_STATUSES = new Set(["active", "completed", "failed", "paused"]);
const WORKSTREAM_STATUSES = new Set(PROGRAM_STATUSES);

export interface SoftwareFactoryPersistence {
  programs: Repository<SoftwareFactoryProgram>;
  workstreams: Repository<Workstream>;
  executionAliases: Repository<SoftwareFactoryTaskAlias>;
}

export interface SoftwareFactoryOrchestratorOptions {
  persistence?: SoftwareFactoryPersistence;
  projectExists?: (projectId: string) => boolean;
}

export class SoftwareFactoryOrchestrator {
  private readonly programs: Repository<SoftwareFactoryProgram>;
  private readonly workstreams: Repository<Workstream>;
  private readonly executionAliases: Repository<SoftwareFactoryTaskAlias>;
  private readonly projectExists: (projectId: string) => boolean;
  private readonly ticks = new Map<string, Promise<void>>();

  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly taskSystem: TaskSystem,
    private readonly environments: SoftwareFactoryEnvironmentProvider,
    options: SoftwareFactoryOrchestratorOptions = {},
  ) {
    this.programs = options.persistence?.programs ?? new InMemoryRepository();
    this.workstreams =
      options.persistence?.workstreams ?? new InMemoryRepository();
    this.executionAliases =
      options.persistence?.executionAliases ?? new InMemoryRepository();
    this.projectExists = options.projectExists ?? (() => true);
    this.validateState();
  }

  createProgram(
    id: string,
    name: string,
    objective: string,
    projectId = "sf",
  ): SoftwareFactoryProgram {
    requireFactoryId(id, "program.id");
    requireText(name, "program.name");
    requireText(objective, "program.objective");
    requireText(projectId, "program.projectId");
    if (!this.projectExists(projectId)) {
      throw new NotFoundError(`unknown project: ${projectId}`);
    }
    if (this.programs.findById(id)) {
      throw new StateTransitionError(`program already exists: ${id}`);
    }
    const timestamp = now();
    const program: SoftwareFactoryProgram = {
      schemaVersion: SOFTWARE_FACTORY_SCHEMA_VERSION,
      id,
      projectId,
      name,
      objective,
      status: "active",
      workstreams: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.programs.upsert(program);
    return program;
  }

  createWorkstream(
    programId: string,
    id: string,
    name: string,
    objective: string,
    projectId?: string,
  ): Workstream {
    requireFactoryId(programId, "workstream.programId");
    requireFactoryId(id, "workstream.id");
    requireText(name, "workstream.name");
    requireText(objective, "workstream.objective");
    const program = this.requireProgram(programId, projectId);
    if (this.workstreams.findById(id)) {
      throw new StateTransitionError(`workstream already exists: ${id}`);
    }
    const timestamp = now();
    const workstream: Workstream = {
      schemaVersion: SOFTWARE_FACTORY_SCHEMA_VERSION,
      id,
      projectId: program.projectId,
      programId: program.id,
      name,
      objective,
      status: "active",
      tasks: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.workstreams.upsert(workstream);
    this.programs.upsert({
      ...program,
      workstreams: [...program.workstreams, id],
      updatedAt: timestamp,
    });
    return workstream;
  }

  addTask(
    workstreamId: string,
    input: SoftwareFactoryTaskInput | TaskDraft,
  ): Task {
    requireFactoryId(workstreamId, "workstream.id");
    const workstream = this.requireWorkstream(workstreamId);
    const candidate = input as TaskDraft;
    if (
      candidate.projectId !== undefined &&
      candidate.projectId !== workstream.projectId
    ) {
      throw new ValidationError("task project does not match its workstream");
    }
    if (
      candidate.programId !== undefined &&
      candidate.programId !== workstream.programId
    ) {
      throw new ValidationError("task program does not match its workstream");
    }
    if (
      candidate.workstreamId !== undefined &&
      candidate.workstreamId !== workstream.id
    ) {
      throw new ValidationError("task workstream does not match its scope");
    }

    const members = new Set(workstream.tasks);
    for (const depId of candidate.dependencies ?? []) {
      const resolved = this.resolveTaskId(depId);
      if (!members.has(depId) && !members.has(resolved)) {
        throw new ValidationError(
          `task dependency "${depId}" is not a task in workstream "${workstreamId}"`,
        );
      }
      const dependency = this.taskSystem.get(resolved);
      if (!dependency) {
        throw new ValidationError(
          `task dependency "${depId}" does not refer to an existing task`,
        );
      }
      this.requireTaskOwnership(dependency, workstream);
    }

    const draft: TaskDraft = {
      ...(candidate as SoftwareFactoryTaskInput),
      projectId: workstream.projectId,
      programId: workstream.programId,
      workstreamId: workstream.id,
      dependencies: candidate.dependencies ?? [],
    };
    const task = this.taskSystem.create(draft);
    const allTasks = [
      ...workstream.tasks.map((id) => this.taskSystem.require(id)),
      task,
    ];
    try {
      ensureDAG(
        allTasks.map((entry) => ({
          ...entry,
          dependencies: (entry.dependencies ?? []).map((dep) =>
            this.resolveTaskId(dep),
          ),
        })),
      );
    } catch (error) {
      this.taskSystem.delete(task.id);
      throw error;
    }

    const updated: Workstream = {
      ...workstream,
      tasks: [...workstream.tasks, task.id],
      updatedAt: now(),
    };
    this.workstreams.upsert(updated);
    const program = this.requireProgram(
      workstream.programId,
      workstream.projectId,
    );
    this.programs.upsert({ ...program, updatedAt: updated.updatedAt });
    return task;
  }

  findProgram(
    programId: string,
    projectId?: string,
  ): SoftwareFactoryProgram | undefined {
    const program = this.programs.findById(programId);
    if (!program) return undefined;
    if (projectId !== undefined && program.projectId !== projectId) {
      return undefined;
    }
    return program;
  }

  findWorkstream(
    workstreamId: string,
    programId?: string,
    projectId?: string,
  ): Workstream | undefined {
    const workstream = this.workstreams.findById(workstreamId);
    if (!workstream) return undefined;
    if (programId !== undefined && workstream.programId !== programId) {
      return undefined;
    }
    if (projectId !== undefined && workstream.projectId !== projectId) {
      return undefined;
    }
    return workstream;
  }

  async tick(programId?: string): Promise<void> {
    if (programId === undefined) {
      for (const program of this.programs.list()) {
        if (program.status === "active") await this.tickProgram(program.id);
      }
      return;
    }
    const inFlight = this.ticks.get(programId);
    if (inFlight) return inFlight;
    const run = this.tickProgram(programId);
    this.ticks.set(programId, run);
    try {
      await run;
    } finally {
      this.ticks.delete(programId);
    }
  }

  private async tickProgram(programId: string): Promise<void> {
    const program = this.requireProgram(programId);
    if (program.status !== "active") {
      throw new StateTransitionError(
        `program ${programId} is not active (status: ${program.status})`,
      );
    }
    for (const workstreamId of [...program.workstreams]) {
      let workstream = this.workstreams.findById(workstreamId);
      if (!workstream || workstream.status !== "active") continue;
      for (const taskId of [...workstream.tasks]) {
        const task = this.taskSystem.get(taskId);
        if (!task || task.status !== "created") continue;
        if (!this.dependenciesMet(task, workstream)) continue;
        const routes = this.routeFor(task);
        const execution = this.resolveExecution(routes);
        if (!execution.allowed) continue;
        const submitted = await this.orchestrator.submit(
          this.toSubmitDraft(task, workstream),
          execution.context,
        );
        if (submitted.id !== task.id) {
          const timestamp = now();
          this.executionAliases.upsert({
            schemaVersion: SOFTWARE_FACTORY_SCHEMA_VERSION,
            id: task.id,
            projectId: workstream.projectId,
            programId: workstream.programId,
            workstreamId: workstream.id,
            taskId: submitted.id,
            createdAt: timestamp,
          });
          workstream = {
            ...workstream,
            tasks: workstream.tasks.map((id) =>
              id === task.id ? submitted.id : id,
            ),
            updatedAt: timestamp,
          };
          this.workstreams.upsert(workstream);
          this.taskSystem.delete(task.id);
        }
      }
    }
  }

  overview(projectIds?: ReadonlySet<string>): SoftwareFactoryOverview {
    const programs = this.programs
      .list()
      .filter((program) => !projectIds || projectIds.has(program.projectId))
      .map((program) => {
        let taskCount = 0;
        let activeTaskCount = 0;
        for (const workstreamId of program.workstreams) {
          const workstream = this.workstreams.findById(workstreamId);
          if (!workstream || workstream.projectId !== program.projectId) {
            continue;
          }
          taskCount += workstream.tasks.length;
          for (const taskId of workstream.tasks) {
            const task = this.taskSystem.get(taskId);
            if (!task) continue;
            try {
              this.requireTaskOwnership(task, workstream);
            } catch {
              continue;
            }
            if (
              task.status !== "completed" &&
              task.status !== "cancelled" &&
              task.status !== "failed"
            ) {
              activeTaskCount += 1;
            }
          }
        }
        return {
          id: program.id,
          projectId: program.projectId,
          name: program.name,
          objective: program.objective,
          status: program.status,
          workstreamIds: [...program.workstreams],
          taskCount,
          activeTaskCount,
          updatedAt: program.updatedAt,
        } satisfies ProgramSummary;
      })
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
    return { programs };
  }

  programDetail(
    programId: string,
    projectId?: string,
  ): SoftwareFactoryProgramDetail | undefined {
    const program = this.programs.findById(programId);
    if (!program) return undefined;
    if (projectId !== undefined && program.projectId !== projectId) {
      return undefined;
    }
    const workstreams = this.programWorkstreams(program.id, program.projectId);
    return {
      program,
      workstreams,
      graph: this.graphFor(workstreams),
      routes: this.routesFor(workstreams),
    };
  }

  getGraphProjection(programId: string, projectId?: string): GraphProjection {
    const program = this.requireProgram(programId, projectId);
    return this.graphFor(
      this.programWorkstreams(program.id, program.projectId),
    );
  }

  private requireProgram(
    programId: string,
    projectId?: string,
  ): SoftwareFactoryProgram {
    const program = this.programs.findById(programId);
    if (
      !program ||
      (projectId !== undefined && program.projectId !== projectId)
    ) {
      throw new NotFoundError(`unknown program: ${programId}`);
    }
    return program;
  }

  private requireWorkstream(workstreamId: string): Workstream {
    const workstream = this.workstreams.findById(workstreamId);
    if (!workstream)
      throw new NotFoundError(`unknown workstream: ${workstreamId}`);
    return workstream;
  }

  private programWorkstreams(
    programId: string,
    projectId: string,
  ): Workstream[] {
    const program = this.programs.findById(programId);
    if (!program || program.projectId !== projectId) return [];
    return program.workstreams
      .map((id) => this.workstreams.findById(id))
      .filter(
        (workstream): workstream is Workstream =>
          workstream !== undefined &&
          workstream.programId === program.id &&
          workstream.projectId === projectId,
      );
  }

  private graphFor(workstreams: readonly Workstream[]): GraphProjection {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const workstream of workstreams) {
      for (const taskId of workstream.tasks) {
        const task = this.taskSystem.get(taskId);
        if (!task) continue;
        try {
          this.requireTaskOwnership(task, workstream);
        } catch {
          continue;
        }
        nodes.push({
          id: task.id,
          task: toTaskView(task, workstream),
          status: task.status,
        });
        for (const depId of task.dependencies ?? []) {
          const from = this.resolveTaskId(depId);
          if (
            nodes.some((node) => node.id === from) ||
            this.taskSystem.get(from)
          ) {
            edges.push({ from, to: task.id, type: "blocking" });
          }
        }
      }
    }
    return { nodes, edges };
  }

  private routesFor(
    workstreams: readonly Workstream[],
  ): TaskEnvironmentRoutingSummary[] {
    const routes: TaskEnvironmentRoutingSummary[] = [];
    for (const workstream of workstreams) {
      for (const taskId of workstream.tasks) {
        const task = this.taskSystem.get(taskId);
        if (!task) continue;
        try {
          this.requireTaskOwnership(task, workstream);
        } catch {
          continue;
        }
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

  private dependenciesMet(task: Task, workstream: Workstream): boolean {
    return (task.dependencies ?? []).every((depId) => {
      const dep = this.taskSystem.get(this.resolveTaskId(depId));
      if (!dep) return false;
      try {
        this.requireTaskOwnership(dep, workstream);
      } catch {
        return false;
      }
      return dep.status === "completed";
    });
  }

  private routeFor(task: Task): readonly EnvironmentCodeRoute[] {
    const codes = task.environmentRequirements ?? [];
    return codes.length === 0 ? [] : this.environments.route(codes);
  }

  private resolveExecution(
    routes: readonly EnvironmentCodeRoute[],
  ):
    | { allowed: true; context: AgentExecutionContext | undefined }
    | { allowed: false } {
    const declared = routes.filter((route) => route.code !== "none");
    if (declared.length === 0) return { allowed: true, context: undefined };
    if (declared.length > 1) return { allowed: false };
    const route = declared[0]!;
    if (route.outcome.outcome !== "ROUTED") return { allowed: false };
    return {
      allowed: true,
      context: {
        environment: {
          code: route.code,
          instanceId: route.outcome.instance.id,
          hostId: route.outcome.host.hostId,
          ...(route.outcome.instance.descriptorId
            ? { descriptorId: route.outcome.instance.descriptorId }
            : {}),
        },
      },
    };
  }

  private toSubmitDraft(task: Task, workstream: Workstream): TaskDraft {
    return {
      type: task.type,
      description: task.description,
      projectId: workstream.projectId,
      input: task.input,
      priority: task.priority,
      requiredPermissions: task.requiredPermissions,
      metadata: { ...task.metadata },
      programId: workstream.programId,
      workstreamId: workstream.id,
      objective: task.objective,
      requirements: task.requirements,
      dependencies: (task.dependencies ?? []).map((depId) =>
        this.resolveTaskId(depId),
      ),
      requiredCapabilities: task.requiredCapabilities,
      environmentRequirements: task.environmentRequirements,
      modelRequirements: task.modelRequirements,
      completionCriteria: task.completionCriteria,
      riskClass: task.riskClass,
    };
  }

  private resolveTaskId(id: string): string {
    const seen = new Set<string>();
    let current = id;
    while (!seen.has(current)) {
      seen.add(current);
      const alias = this.executionAliases.findById(current);
      if (!alias) return current;
      current = alias.taskId;
    }
    throw new StateTransitionError(`cyclic task alias at ${id}`);
  }

  private requireTaskOwnership(task: Task, workstream: Workstream): void {
    if (
      task.projectId !== workstream.projectId ||
      task.programId !== workstream.programId ||
      task.workstreamId !== workstream.id
    ) {
      throw new StateTransitionError(
        `task ${task.id} does not belong to workstream ${workstream.id}`,
      );
    }
  }

  private validateState(): void {
    for (const program of this.programs.list()) {
      if (program.schemaVersion !== SOFTWARE_FACTORY_SCHEMA_VERSION) {
        throw new StateTransitionError(
          `unsupported software factory program schema: ${program.id}`,
        );
      }
      requireFactoryId(program.id, "program.id");
      requireText(program.projectId, "program.projectId");
      if (!PROGRAM_STATUSES.has(program.status)) {
        throw new StateTransitionError(`invalid program status: ${program.id}`);
      }
      for (const workstreamId of program.workstreams) {
        const workstream = this.workstreams.findById(workstreamId);
        if (
          !workstream ||
          workstream.programId !== program.id ||
          workstream.projectId !== program.projectId
        ) {
          throw new StateTransitionError(
            `workstream ${workstreamId} is not owned by program ${program.id}`,
          );
        }
      }
    }
    for (const workstream of this.workstreams.list()) {
      if (workstream.schemaVersion !== SOFTWARE_FACTORY_SCHEMA_VERSION) {
        throw new StateTransitionError(
          `unsupported software factory workstream schema: ${workstream.id}`,
        );
      }
      requireFactoryId(workstream.id, "workstream.id");
      requireText(workstream.projectId, "workstream.projectId");
      if (!WORKSTREAM_STATUSES.has(workstream.status)) {
        throw new StateTransitionError(
          `invalid workstream status: ${workstream.id}`,
        );
      }
      const program = this.programs.findById(workstream.programId);
      if (!program || program.projectId !== workstream.projectId) {
        throw new StateTransitionError(
          `workstream ${workstream.id} has an invalid program`,
        );
      }
    }
    for (const alias of this.executionAliases.list()) {
      if (alias.schemaVersion !== SOFTWARE_FACTORY_SCHEMA_VERSION) {
        throw new StateTransitionError(
          `unsupported software factory alias schema: ${alias.id}`,
        );
      }
      const workstream = this.workstreams.findById(alias.workstreamId);
      if (
        !workstream ||
        workstream.projectId !== alias.projectId ||
        workstream.programId !== alias.programId ||
        alias.id === alias.taskId
      ) {
        throw new StateTransitionError(
          `task alias ${alias.id} is not owned by its workstream`,
        );
      }
    }
  }
}

function requireFactoryId(value: string, field: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be a lowercase identifier`);
  }
}

function toTaskView(
  task: Task,
  workstream: Workstream,
): SoftwareFactoryTaskView {
  return {
    id: task.id,
    type: task.type,
    description: task.description,
    projectId: workstream.projectId,
    programId: workstream.programId,
    workstreamId: workstream.id,
    ...(task.assignedAgentId ? { assignedAgentId: task.assignedAgentId } : {}),
    priority: task.priority,
    status: task.status,
    errors: [...task.errors],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.objective !== undefined ? { objective: task.objective } : {}),
    requirements: [...(task.requirements ?? [])],
    dependencies: [...(task.dependencies ?? [])],
    requiredCapabilities: [...(task.requiredCapabilities ?? [])],
    environmentRequirements: [...(task.environmentRequirements ?? [])],
    completionCriteria: [...(task.completionCriteria ?? [])],
    ...(task.riskClass !== undefined ? { riskClass: task.riskClass } : {}),
  };
}

function ensureDAG(tasks: readonly Task[]): void {
  const adjacency = new Map<string, string[]>();
  for (const task of tasks) {
    if (!adjacency.has(task.id)) adjacency.set(task.id, []);
    for (const dep of task.dependencies ?? []) {
      const edges = adjacency.get(dep) ?? [];
      edges.push(task.id);
      adjacency.set(dep, edges);
    }
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  const visit = (id: string): boolean => {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) return true;
    }
    stack.delete(id);
    return false;
  };
  for (const id of adjacency.keys()) {
    if (visit(id)) {
      throw new ValidationError(
        "cycle detected in workstream task dependencies",
      );
    }
  }
}

function routingStatus(
  route: EnvironmentCodeRoute,
): TaskEnvironmentRoutingSummary["status"] {
  if (route.code === "none") return "skipped";
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

function routingDetail(route: EnvironmentCodeRoute): string {
  if (route.code === "none") return "no environment required";
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
