/**
 * PromptIntelligenceService (Phase 3) — the orchestration of
 *
 *   request → intent → context → prompt → validation → PreparedExecutionRequest
 *
 * It owns authorization, input bounds, secret refusal, project isolation,
 * traceability and the approval hand-off to the EXISTING `ApprovalSystem`.
 * It never executes an agent, tool or command: its output is data that the
 * Phase 4 Project Manager / Agent Router consumes.
 *
 *   PREPARED != APPROVED:  `executionReady` is true only when validation
 *   passed AND any mandatory approval has been granted by a human.
 */
import { randomBytes } from "node:crypto";
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  operatorCan,
  operatorCanAccessProject,
  type OperatorPrincipal,
  type Repository,
} from "../../contracts/index.js";
import { canonicalizeCapability } from "../../contracts/capabilities.js";
import {
  MAX_REQUEST_LENGTH,
  UNRESOLVED_PROJECT,
  type ApprovalState,
  type ApprovalTrace,
  type PreparedExecutionRequest,
  type PromptRequestRecord,
  type PromptRequestSummary,
  type PromptRequestView,
} from "../../contracts/prompt-intelligence.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AgentRegistry } from "../registry/agent-registry.js";
import type { ProjectRegistry } from "../registry/project-registry.js";
import type { ContextEngine } from "./context-engine.js";
import type { IntentAnalyzer, ProjectCandidate } from "./intent-analyzer.js";
import { PromptEngineer } from "./prompt-engineer.js";
import { PromptValidator, approvalRequiredFor } from "./prompt-validator.js";
import { containsSecret } from "./secret-scan.js";

export interface PromptIntelligenceDeps {
  projects: Pick<ProjectRegistry, "list" | "has">;
  analyzer: IntentAnalyzer;
  engine: ContextEngine;
  records: Repository<PromptRequestRecord>;
  approvals: Pick<ApprovalSystem, "request" | "get">;
  agents: Pick<AgentRegistry, "list">;
  engineer?: PromptEngineer;
  validator?: PromptValidator;
  clock?: () => string;
  newId?: () => string;
}

export interface PrepareInput {
  request?: unknown;
  projectId?: unknown;
  taskId?: unknown;
  correlationId?: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export class PromptIntelligenceService {
  private readonly engineer: PromptEngineer;
  private readonly validator: PromptValidator;
  private readonly clock: () => string;
  private readonly newId: () => string;

  constructor(private readonly deps: PromptIntelligenceDeps) {
    this.engineer = deps.engineer ?? new PromptEngineer();
    this.validator = deps.validator ?? new PromptValidator();
    this.clock = deps.clock ?? (() => new Date().toISOString());
    this.newId = deps.newId ?? (() => `pr-${randomBytes(6).toString("hex")}`);
  }

  /* -------------------------------------------------------------- */
  /* authorization                                                  */
  /* -------------------------------------------------------------- */

  private requirePreparer(principal: OperatorPrincipal): void {
    if (!operatorCan(principal, "prepare_prompt")) {
      throw new PermissionDeniedError(
        `role "${principal.role}" may not prepare execution prompts`,
      );
    }
  }

  private requireReader(principal: OperatorPrincipal): void {
    if (!operatorCan(principal, "view")) {
      throw new PermissionDeniedError(
        "insufficient capabilities to read prompt requests",
      );
    }
  }

  /** A record is visible to project members; an unresolved one only to its author. */
  private canSee(
    principal: OperatorPrincipal,
    record: PromptRequestRecord,
  ): boolean {
    return record.projectId === UNRESOLVED_PROJECT
      ? record.requestedBy === principal.id
      : operatorCanAccessProject(principal, record.projectId);
  }

  private candidates(principal: OperatorPrincipal): ProjectCandidate[] {
    return (
      this.deps.projects
        .list()
        // The reserved id can never be a real, selectable project.
        .filter((p) => p.projectId !== UNRESOLVED_PROJECT)
        .filter((p) => operatorCanAccessProject(principal, p.projectId))
        .map((p) => ({
          projectId: p.projectId,
          displayName: p.displayName,
          ...(typeof p.metadata["code"] === "string"
            ? { code: p.metadata["code"] }
            : {}),
        }))
    );
  }

  /* -------------------------------------------------------------- */
  /* prepare                                                        */
  /* -------------------------------------------------------------- */

  async prepare(
    principal: OperatorPrincipal,
    input: PrepareInput,
  ): Promise<PromptRequestView> {
    this.requirePreparer(principal);
    const text = this.requireRequest(input.request);
    const explicitProjectId = this.optionalId(input.projectId, "projectId");
    const taskId = this.optionalId(input.taskId, "taskId");

    const now = this.clock();
    const requestId = this.newId();
    const intent = this.deps.analyzer.analyze({
      request: text,
      projects: this.candidates(principal),
      ...(explicitProjectId ? { explicitProjectId } : {}),
    });

    const projectId = intent.project.projectId;
    const projectExists =
      projectId !== undefined && this.deps.projects.has(projectId);
    // An unresolved project still resolves the platform-wide context (the
    // mandatory security baseline) — and nothing project-specific, because no
    // source can match the reserved id. The prompt therefore always carries the
    // security requirements, even when it can only ask a clarifying question.
    const context = await this.deps.engine.resolve({
      projectId: projectExists ? projectId : UNRESOLVED_PROJECT,
      ...(taskId ? { taskId } : {}),
      intent,
      // Server-derived: clearance is never taken from the client.
      audience: {
        capabilities: intent.requiredCapabilities.map((c) => c.capability),
        clearance: "internal",
      },
    });

    const prompt = this.engineer.generate({
      requestId,
      version: 1,
      projectId: projectExists ? projectId : UNRESOLVED_PROJECT,
      ...(taskId ? { taskId } : {}),
      intent,
      context,
      createdAt: now,
    });
    const validation = this.validator.validate({
      intent,
      context,
      prompt,
      projectExists,
      registeredCapabilities: this.registeredCapabilities(),
    });
    const approval: ApprovalTrace = {
      state:
        approvalRequiredFor(intent).length > 0 ? "required" : "not_required",
    };
    const record: PromptRequestRecord = {
      id: requestId,
      requestId,
      projectId: projectExists ? projectId : UNRESOLVED_PROJECT,
      ...(taskId ? { taskId } : {}),
      requestedBy: principal.id,
      createdAt: now,
      updatedAt: now,
      request: text,
      intent,
      context,
      prompt,
      validation,
      approval,
      executionState: "not_started",
      contextSources: context.sources
        .filter((s) => s.status === "ok")
        .map((s) => s.source),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      revision: 1,
    };
    this.deps.records.upsert(record);
    return this.view(record);
  }

  /* -------------------------------------------------------------- */
  /* approval hand-off (existing ApprovalSystem)                    */
  /* -------------------------------------------------------------- */

  async requestApproval(
    principal: OperatorPrincipal,
    input: { requestId?: unknown },
  ): Promise<PromptRequestView> {
    this.requirePreparer(principal);
    const record = this.mustSee(principal, input.requestId);
    if (record.validation.status !== "APPROVAL_REQUIRED") {
      throw new StateTransitionError(
        `no approval can be requested: validation is ${record.validation.status}`,
      );
    }
    const state = this.approvalState(record);
    if (state === "requested" || state === "approved") {
      return this.view(record); // idempotent: never a second approval
    }
    const destructive = record.intent.destructive.length > 0;
    const approval = this.deps.approvals.request({
      requestedBy: principal.id,
      action: destructive
        ? "prompt_request.execute_delete_operation"
        : "prompt_request.execute_production_deployment",
      reason: `Approval required before executing request ${record.requestId}: ${record.validation.reasons.join("; ")}`,
      metadata: {
        projectId: record.projectId,
        requestId: record.requestId,
        promptVersion: record.prompt.version,
        approvalKind: "prompt_request",
      },
    });
    const next: PromptRequestRecord = {
      ...record,
      approval: { state: "requested", approvalId: approval.id },
      updatedAt: this.clock(),
      revision: record.revision + 1,
    };
    this.deps.records.upsert(next);
    return this.view(next);
  }

  /* -------------------------------------------------------------- */
  /* reads                                                          */
  /* -------------------------------------------------------------- */

  list(
    principal: OperatorPrincipal,
    filter: { projectId?: string; limit?: number } = {},
  ): PromptRequestSummary[] {
    this.requireReader(principal);
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return this.deps.records
      .list()
      .filter((r) => this.canSee(principal, r))
      .filter((r) =>
        filter.projectId ? r.projectId === filter.projectId : true,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((r) => this.summary(r));
  }

  get(principal: OperatorPrincipal, requestId: string): PromptRequestView {
    this.requireReader(principal);
    const record = this.deps.records.findById(requestId);
    // A foreign record is indistinguishable from a missing one (no IDOR probe).
    if (!record || !this.canSee(principal, record)) {
      throw new NotFoundError("prompt request not found");
    }
    return this.view(record);
  }

  /** The typed hand-off Phase 4 consumes. */
  executionRequest(record: PromptRequestRecord): PreparedExecutionRequest {
    const state = this.approvalState(record);
    const status = record.validation.status;
    const blockedBy: string[] = [];
    if (status === "BLOCKED" || status === "CLARIFY") {
      blockedBy.push(...record.validation.reasons);
    }
    if (record.validation.approvalRequired && state !== "approved") {
      blockedBy.push(
        state === "rejected"
          ? "the approval was rejected"
          : state === "expired"
            ? "the approval expired"
            : state === "requested"
              ? "waiting for human approval"
              : "human approval has not been requested",
      );
    }
    const ready =
      (status === "PASS" ||
        status === "WARN" ||
        status === "APPROVAL_REQUIRED") &&
      blockedBy.length === 0;
    return {
      requestId: record.requestId,
      projectId: record.projectId,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      promptVersion: record.prompt.version,
      prompt: record.prompt.text,
      requiredCapabilities: record.intent.requiredCapabilities,
      validation: status,
      approval: { ...record.approval, state },
      executionReady: ready,
      blockedBy,
    };
  }

  /* -------------------------------------------------------------- */
  /* helpers                                                        */
  /* -------------------------------------------------------------- */

  private view(record: PromptRequestRecord): PromptRequestView {
    const execution = this.executionRequest(record);
    return {
      record: { ...record, approval: execution.approval },
      execution,
    };
  }

  private summary(record: PromptRequestRecord): PromptRequestSummary {
    const execution = this.executionRequest(record);
    return {
      requestId: record.requestId,
      projectId: record.projectId,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      requestedBy: record.requestedBy,
      createdAt: record.createdAt,
      intent: record.intent.category,
      validation: record.validation.status,
      approval: execution.approval.state,
      executionReady: execution.executionReady,
      requiredCapabilities: record.intent.requiredCapabilities.map(
        (c) => c.capability,
      ),
      request: record.request,
    };
  }

  /** The approval state is derived from the live approval, never trusted from the record. */
  private approvalState(record: PromptRequestRecord): ApprovalState {
    if (!record.validation.approvalRequired) return "not_required";
    const id = record.approval.approvalId;
    if (!id) return "required";
    const approval = this.deps.approvals.get(id);
    if (!approval) return "required";
    return approval.status === "requested" ? "requested" : approval.status;
  }

  private mustSee(
    principal: OperatorPrincipal,
    requestId: unknown,
  ): PromptRequestRecord {
    const id = this.optionalId(requestId, "requestId");
    const record = id ? this.deps.records.findById(id) : undefined;
    if (!record || !this.canSee(principal, record)) {
      throw new NotFoundError("prompt request not found");
    }
    return record;
  }

  private registeredCapabilities(): string[] {
    const out = new Set<string>();
    for (const agent of this.deps.agents.list()) {
      for (const label of agent.capabilities) {
        const canonical = canonicalizeCapability(label);
        if (canonical) out.add(canonical);
      }
    }
    return [...out];
  }

  private requireRequest(value: unknown): string {
    if (typeof value !== "string")
      throw new ValidationError("request is required");
    const text = value.replace(/\s+/g, " ").trim();
    if (text === "") throw new ValidationError("request is required");
    if (text.length > MAX_REQUEST_LENGTH) {
      throw new ValidationError(
        `request must be at most ${MAX_REQUEST_LENGTH} characters`,
      );
    }
    if (CONTROL.test(value))
      throw new ValidationError("request contains control characters");
    if (containsSecret(text)) {
      // Never stored, never echoed.
      throw new ValidationError(
        "the request appears to contain a credential; remove it and refer to the secret by name",
      );
    }
    return text;
  }

  private optionalId(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string" || !ID.test(value)) {
      throw new ValidationError(`${field} is not a valid identifier`);
    }
    return value;
  }
}
