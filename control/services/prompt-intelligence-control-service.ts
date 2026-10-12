/**
 * PromptIntelligenceControlService — the governed command/query surface for
 * the Context Engine + Prompt Intelligence layer (Phase 3).
 *
 * Every command is authorized by the domain service, audited as a
 * `control_command` (denied and rejected included, with secret-free
 * traceability metadata) and returned as a structured `ControlCommandResult`.
 * The UI never mutates state itself, and nothing here executes an agent.
 */
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  type CommandOptions,
  type ControlCommand,
  type ControlCommandResult,
  type ControlErrorKind,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import type {
  PromptRequestSummary,
  PromptRequestView,
} from "../../contracts/prompt-intelligence.js";
import type { AuditLog, PromptIntelligenceService } from "../../core/index.js";
import { resolveCorrelationId } from "../correlation.js";
import { redact } from "../redaction.js";

type Body = Record<string, unknown>;

export class PromptIntelligenceControlService {
  constructor(
    private readonly service: PromptIntelligenceService,
    private readonly audit: AuditLog,
  ) {}

  list(
    principal: OperatorPrincipal,
    filter: { projectId?: string; limit?: number } = {},
  ): PromptRequestSummary[] {
    return this.service.list(principal, filter);
  }
  get(principal: OperatorPrincipal, requestId: string): PromptRequestView {
    return this.service.get(principal, requestId);
  }

  promptPrepare(p: OperatorPrincipal, b: Body, o?: CommandOptions) {
    const correlationId = resolveCorrelationId(o);
    return this.run(p, "prompt_prepare", b, correlationId, () =>
      this.service.prepare(p, {
        request: b?.["request"],
        projectId: b?.["projectId"],
        taskId: b?.["taskId"],
        correlationId,
      }),
    );
  }

  promptRequestApproval(p: OperatorPrincipal, b: Body, o?: CommandOptions) {
    const correlationId = resolveCorrelationId(o);
    return this.run(p, "prompt_request_approval", b, correlationId, () =>
      this.service.requestApproval(p, { requestId: b?.["requestId"] }),
    );
  }

  private async run(
    principal: OperatorPrincipal,
    command: ControlCommand,
    body: Body,
    correlationId: string,
    action: () => Promise<PromptRequestView>,
  ): Promise<ControlCommandResult> {
    const resourceId =
      typeof body?.["requestId"] === "string"
        ? (body["requestId"] as string)
        : undefined;
    try {
      const view = await action();
      const r = view.record;
      return this.result(
        principal,
        command,
        "executed",
        undefined,
        "ok",
        r.requestId,
        correlationId,
        {
          projectId: r.projectId,
          requestId: r.requestId,
          taskId: r.taskId,
          intent: r.intent.category,
          risk: r.intent.risk,
          contextSources: r.contextSources,
          promptVersion: r.prompt.version,
          requiredCapabilities: r.intent.requiredCapabilities.map(
            (c) => c.capability,
          ),
          validation: r.validation.status,
          approval: view.execution.approval.state,
          executionState: r.executionState,
          executionReady: view.execution.executionReady,
          view,
        },
      );
    } catch (error) {
      const { outcome, kind } = classify(error);
      return this.result(
        principal,
        command,
        outcome,
        kind,
        errorText(error),
        resourceId,
        correlationId,
        {},
      );
    }
  }

  private result(
    principal: OperatorPrincipal,
    command: ControlCommand,
    outcome: ControlCommandResult["outcome"],
    errorKind: ControlErrorKind | undefined,
    reason: string,
    resourceId: string | undefined,
    correlationId: string,
    details: Record<string, unknown>,
  ): ControlCommandResult {
    // The audit copy never carries the request/prompt text (large, and not needed).
    const { view: _view, ...auditDetails } = details;
    void _view;
    const event = this.audit.record("control_command", {
      projectId:
        typeof details["projectId"] === "string"
          ? details["projectId"]
          : undefined,
      data: {
        ...redact(auditDetails),
        command,
        outcome,
        errorKind,
        correlationId,
        actor: principal?.id ?? "unknown",
        actorRole: principal?.role ?? "unknown",
        resourceId,
        reason,
      },
    });
    return {
      command,
      outcome,
      ok: outcome === "executed",
      errorKind,
      reason,
      resourceId,
      correlationId,
      // The view is secret-free by construction (scanned at input, filtered in
      // the engine, scanned again on the prompt); the browser renders it.
      details: {
        ...(redact(auditDetails) as Record<string, unknown>),
        ...(details["view"] ? { view: details["view"] } : {}),
      },
      auditEventId: event.id,
      timestamp: new Date().toISOString(),
    };
  }
}

function classify(error: unknown): {
  outcome: ControlCommandResult["outcome"];
  kind: ControlErrorKind;
} {
  if (error instanceof PermissionDeniedError)
    return { outcome: "denied", kind: "forbidden" };
  if (error instanceof NotFoundError)
    return { outcome: "rejected", kind: "not_found" };
  if (error instanceof StateTransitionError)
    return { outcome: "rejected", kind: "invalid_state" };
  if (error instanceof ValidationError)
    return { outcome: "rejected", kind: "invalid_request" };
  return { outcome: "rejected", kind: "command_failure" };
}

function errorText(error: unknown): string {
  // Typed domain errors carry operator-safe messages; anything else is generic.
  if (
    error instanceof PermissionDeniedError ||
    error instanceof NotFoundError ||
    error instanceof StateTransitionError ||
    error instanceof ValidationError
  ) {
    return error.message;
  }
  return "the command failed";
}
