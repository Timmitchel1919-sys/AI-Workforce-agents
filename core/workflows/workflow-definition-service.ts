/**
 * Workflow Studio backend (UI Layer 4): durable, versioned workflow
 * DEFINITIONS. Authoring only — this service never runs a workflow. Execution
 * stays with the existing `WorkflowEngine`.
 *
 * Persistence goes through the durable `ExecutionRecordStore` (Firestore in
 * production), so drafts and published versions survive instance restarts:
 *   - `workflow_definition` — the mutable head (draft + lifecycle), `put`.
 *   - `workflow_version`    — one immutable record per published version,
 *                             `create` (create-only: a version can never be
 *                             overwritten). Grouped by `sessionId = definitionId`.
 *
 * Every write re-validates on the server against the REAL agent and tool
 * registries. Authorization (role + project) is enforced by the caller
 * (the Control Plane command service); this service re-checks project
 * ownership of every definition it touches.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  NotFoundError,
  StateTransitionError,
  ValidationError,
  canonicalGraphJson,
  candidateAgents,
  isDraftValidated,
  normalizeWorkflowGraph,
  topologicalOrder,
  validateWorkflowGraph,
  type ExecutionRecordStore,
  type WorkflowCapabilityContext,
  type WorkflowDefinition,
  type WorkflowGraph,
  type WorkflowSimulation,
  type WorkflowSimulationStep,
  type WorkflowValidationResult,
  type WorkflowVersion,
} from "../../contracts/index.js";

const DEF_KIND = "workflow_definition";
const VERSION_KIND = "workflow_version";
const MAX_DEFINITIONS_PER_PROJECT = 200;
const MAX_VERSIONS_LISTED = 100;

export interface WorkflowDefinitionServiceDeps {
  store: ExecutionRecordStore;
  /** Real registries — read at validation time, never cached. */
  capabilities: (projectId: string) => WorkflowCapabilityContext;
  clock?: () => number;
  newId?: () => string;
}

export interface SaveDraftInput {
  projectId: string;
  /** Omit to create a new definition. */
  definitionId?: string;
  /** Required when updating: the revision the editor started from. */
  expectedRevision?: number;
  name: string;
  description?: string;
  graph: unknown;
}

function defKey(id: string) {
  return `wfdef_${id}`;
}
function versionKey(id: string, version: number) {
  return `wfver_${id}_${version}`;
}

function requireName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 120)
    throw new ValidationError("name must be 1-120 characters");
  return value.trim();
}

export class WorkflowDefinitionService {
  private readonly store: ExecutionRecordStore;
  private readonly capabilities: (
    projectId: string,
  ) => WorkflowCapabilityContext;
  private readonly clock: () => number;
  private readonly newId: () => string;

  constructor(deps: WorkflowDefinitionServiceDeps) {
    this.store = deps.store;
    this.capabilities = deps.capabilities;
    this.clock = deps.clock ?? Date.now;
    this.newId =
      deps.newId ?? (() => `wf_${randomUUID().replace(/-/g, "").slice(0, 20)}`);
  }

  private iso(): string {
    return new Date(this.clock()).toISOString();
  }

  /** Normalize + authoritative validation. Never persists. */
  validate(
    projectId: string,
    graphInput: unknown,
  ): { graph: WorkflowGraph; result: WorkflowValidationResult } {
    const { graph, issues } = normalizeWorkflowGraph(graphInput);
    const result = validateWorkflowGraph(graph, this.capabilities(projectId));
    const all = [...issues, ...result.issues];
    return {
      graph,
      result: { valid: all.every((i) => i.severity !== "error"), issues: all },
    };
  }

  async list(projectId: string): Promise<WorkflowDefinition[]> {
    const defs = await this.store.listBy<WorkflowDefinition>(
      "projectId",
      projectId,
      {
        kind: DEF_KIND,
        limit: MAX_DEFINITIONS_PER_PROJECT,
      },
    );
    return defs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Project-checked read. A definition from another project is NOT FOUND. */
  async get(
    projectId: string,
    definitionId: string,
  ): Promise<WorkflowDefinition | undefined> {
    const def = await this.store.get<WorkflowDefinition>(defKey(definitionId));
    return def && def.projectId === projectId ? def : undefined;
  }

  private async require(
    projectId: string,
    definitionId: unknown,
  ): Promise<WorkflowDefinition> {
    if (typeof definitionId !== "string" || definitionId.trim() === "")
      throw new ValidationError("definitionId is required");
    const def = await this.get(projectId, definitionId);
    if (!def)
      throw new NotFoundError(`workflow definition ${definitionId} not found`);
    return def;
  }

  async versions(
    projectId: string,
    definitionId: string,
  ): Promise<WorkflowVersion[]> {
    const def = await this.get(projectId, definitionId);
    if (!def) return [];
    const versions = await this.store.listBy<WorkflowVersion>(
      "sessionId",
      definitionId,
      {
        kind: VERSION_KIND,
        limit: MAX_VERSIONS_LISTED,
      },
    );
    return versions
      .filter((v) => v.projectId === projectId)
      .sort((a, b) => b.version - a.version);
  }

  async version(
    projectId: string,
    definitionId: string,
    version: number,
  ): Promise<WorkflowVersion | undefined> {
    const v = await this.store.get<WorkflowVersion>(
      versionKey(definitionId, version),
    );
    return v && v.projectId === projectId && v.definitionId === definitionId
      ? v
      : undefined;
  }

  private async write(def: WorkflowDefinition): Promise<void> {
    await this.store.put(
      defKey(def.definitionId),
      { projectId: def.projectId, kind: DEF_KIND, createdAt: def.updatedAt },
      def,
    );
  }

  /**
   * Save a draft. A draft MAY be invalid (work in progress); its validation is
   * recorded so the UI shows the server's verdict, and publishing re-checks.
   */
  async saveDraft(
    input: SaveDraftInput,
    actor: string,
  ): Promise<WorkflowDefinition> {
    const name = requireName(input.name);
    const description =
      typeof input.description === "string"
        ? input.description.trim().slice(0, 1000)
        : "";
    const { graph, result } = this.validate(input.projectId, input.graph);
    if (
      result.issues.some(
        (i) => i.code === "INVALID_SHAPE" || i.code === "LIMIT_EXCEEDED",
      )
    )
      throw new ValidationError(
        result.issues.find(
          (i) => i.code === "INVALID_SHAPE" || i.code === "LIMIT_EXCEEDED",
        )!.message,
      );
    if (result.issues.some((i) => i.code === "CREDENTIAL_IN_GRAPH"))
      throw new ValidationError(
        "a node appears to contain a credential; credentials are never stored in workflow graphs",
      );
    const at = this.iso();

    if (input.definitionId === undefined) {
      const existing = await this.list(input.projectId);
      if (existing.length >= MAX_DEFINITIONS_PER_PROJECT)
        throw new ValidationError(
          `a project may hold at most ${MAX_DEFINITIONS_PER_PROJECT} workflow definitions`,
        );
      const def: WorkflowDefinition = {
        definitionId: this.newId(),
        projectId: input.projectId,
        name,
        description,
        status: "draft",
        draft: graph,
        draftRevision: 1,
        lastValidation: { ...result, draftRevision: 1, validatedAt: at },
        createdAt: at,
        createdBy: actor,
        updatedAt: at,
        updatedBy: actor,
      };
      await this.write(def);
      return def;
    }

    const current = await this.require(input.projectId, input.definitionId);
    if (current.status === "archived")
      throw new StateTransitionError(
        "an archived workflow cannot be edited; restore a version first",
      );
    if (input.expectedRevision !== current.draftRevision)
      throw new StateTransitionError(
        `the draft changed since you opened it (revision ${current.draftRevision}); reload before saving`,
      );
    const revision = current.draftRevision + 1;
    const next: WorkflowDefinition = {
      ...current,
      name,
      description,
      draft: graph,
      draftRevision: revision,
      lastValidation: { ...result, draftRevision: revision, validatedAt: at },
      updatedAt: at,
      updatedBy: actor,
    };
    await this.write(next);
    return next;
  }

  /** Re-validate the stored draft against the CURRENT registries. */
  async validateStored(
    projectId: string,
    definitionId: unknown,
    actor: string,
  ) {
    const def = await this.require(projectId, definitionId);
    const { result } = this.validate(projectId, def.draft);
    const at = this.iso();
    const next: WorkflowDefinition = {
      ...def,
      lastValidation: {
        ...result,
        draftRevision: def.draftRevision,
        validatedAt: at,
      },
      updatedAt: at,
      updatedBy: actor,
    };
    await this.write(next);
    return next;
  }

  /**
   * Publish the current draft as a new IMMUTABLE version. Refused unless the
   * server validates it right now (a stale "valid" flag is never trusted).
   */
  async publish(
    projectId: string,
    definitionId: unknown,
    expectedRevision: unknown,
    actor: string,
  ): Promise<{ definition: WorkflowDefinition; version: WorkflowVersion }> {
    const def = await this.require(projectId, definitionId);
    if (def.status === "archived")
      throw new StateTransitionError(
        "an archived workflow cannot be published",
      );
    if (expectedRevision !== def.draftRevision)
      throw new StateTransitionError(
        `the draft changed since it was reviewed (revision ${def.draftRevision}); review it again`,
      );
    const { graph, result } = this.validate(projectId, def.draft);
    if (!result.valid)
      throw new ValidationError(
        `the draft does not validate: ${result.issues
          .filter((i) => i.severity === "error")
          .slice(0, 3)
          .map((i) => i.message)
          .join("; ")}`,
      );
    const versionNumber = (def.latestPublishedVersion ?? 0) + 1;
    const at = this.iso();
    const canonical = canonicalGraphJson(graph);
    const version: WorkflowVersion = {
      definitionId: def.definitionId,
      projectId,
      version: versionNumber,
      name: def.name,
      graph,
      graphHash: createHash("sha256").update(canonical).digest("hex"),
      draftRevision: def.draftRevision,
      publishedAt: at,
      publishedBy: actor,
    };
    // Create-only: two concurrent publishes of the same number cannot both win.
    await this.store.create(
      versionKey(def.definitionId, versionNumber),
      {
        projectId,
        kind: VERSION_KIND,
        createdAt: at,
        sessionId: def.definitionId,
      },
      version,
    );
    const next: WorkflowDefinition = {
      ...def,
      status: "published",
      latestPublishedVersion: versionNumber,
      lastValidation: {
        ...result,
        draftRevision: def.draftRevision,
        validatedAt: at,
      },
      updatedAt: at,
      updatedBy: actor,
    };
    await this.write(next);
    return { definition: next, version };
  }

  async archive(projectId: string, definitionId: unknown, actor: string) {
    const def = await this.require(projectId, definitionId);
    if (def.status === "archived") return def; // idempotent
    const at = this.iso();
    const next: WorkflowDefinition = {
      ...def,
      status: "archived",
      archivedAt: at,
      updatedAt: at,
      updatedBy: actor,
    };
    await this.write(next);
    return next;
  }

  /**
   * Governed rollback: copy a published version into a NEW draft revision.
   * Published versions and their history are never modified or deleted.
   */
  async restoreVersion(
    projectId: string,
    definitionId: unknown,
    versionNumber: unknown,
    actor: string,
  ): Promise<WorkflowDefinition> {
    const def = await this.require(projectId, definitionId);
    if (
      typeof versionNumber !== "number" ||
      !Number.isInteger(versionNumber) ||
      versionNumber < 1
    )
      throw new ValidationError("version must be a positive integer");
    const v = await this.version(projectId, def.definitionId, versionNumber);
    if (!v) throw new NotFoundError(`version ${versionNumber} not found`);
    const { result } = this.validate(projectId, v.graph);
    const at = this.iso();
    const revision = def.draftRevision + 1;
    const next: WorkflowDefinition = {
      ...def,
      status: def.latestPublishedVersion ? "published" : "draft",
      archivedAt: undefined,
      draft: v.graph,
      draftRevision: revision,
      lastValidation: { ...result, draftRevision: revision, validatedAt: at },
      updatedAt: at,
      updatedBy: actor,
    };
    await this.write(next);
    return next;
  }

  /** Duplicate into a new draft definition in the same project. */
  async duplicate(projectId: string, definitionId: unknown, actor: string) {
    const def = await this.require(projectId, definitionId);
    return this.saveDraft(
      {
        projectId,
        name: `${def.name} (copy)`.slice(0, 120),
        description: def.description,
        graph: def.draft,
      },
      actor,
    );
  }

  /**
   * SIMULATION — computes what the existing engine WOULD do, from real
   * registry data. It never calls an agent, model, tool or approval and never
   * creates a task or workflow. Pure read.
   */
  async simulate(
    projectId: string,
    definitionId: unknown,
    source: "draft" | number,
  ): Promise<WorkflowSimulation> {
    const def = await this.require(projectId, definitionId);
    let graphInput: unknown = def.draft;
    if (source !== "draft") {
      const v = await this.version(projectId, def.definitionId, source);
      if (!v) throw new NotFoundError(`version ${source} not found`);
      graphInput = v.graph;
    }
    const { graph, result } = this.validate(projectId, graphInput);
    const ctx = this.capabilities(projectId);
    const steps: WorkflowSimulationStep[] = [];
    if (result.valid) {
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      topologicalOrder(graph).forEach((nodeId, index) => {
        const node = byId.get(nodeId)!;
        const order = index + 1;
        if (node.kind === "trigger")
          steps.push({
            order,
            nodeId,
            kind: node.kind,
            outcome: "would_start",
            detail: "manual trigger",
          });
        else if (node.kind === "terminal")
          steps.push({
            order,
            nodeId,
            kind: node.kind,
            outcome: "would_complete",
            detail: "workflow ends",
          });
        else if (node.kind === "approval")
          steps.push({
            order,
            nodeId,
            kind: node.kind,
            outcome: "would_wait_for_approval",
            detail: `pauses until a human approves: ${node.config.approvalAction}`,
          });
        else {
          const candidates = candidateAgents(node, ctx);
          steps.push(
            candidates[0]
              ? {
                  order,
                  nodeId,
                  kind: node.kind,
                  outcome: "would_dispatch",
                  resolvedAgentId: candidates[0],
                  detail: `task "${node.config.taskType}" to ${candidates[0]}`,
                }
              : {
                  order,
                  nodeId,
                  kind: node.kind,
                  outcome: "blocked",
                  detail: "no qualified enabled agent",
                },
          );
        }
      });
    }
    return {
      mode: "simulation",
      sideEffectFree: true,
      definitionId: def.definitionId,
      source,
      valid: result.valid,
      steps,
      issues: result.issues,
      simulatedAt: this.iso(),
    };
  }

  /** Whether the stored draft is VALIDATED at its current revision. */
  static isValidated(def: WorkflowDefinition): boolean {
    return isDraftValidated(def);
  }
}
