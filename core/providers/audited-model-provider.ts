import {
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  ProviderError,
} from "../../contracts/index.js";
import { AuditLog } from "../audit/audit-log.js";

export interface AuditedModelProviderOptions {
  /**
   * Include a truncated preview of prompt and completion text in the audit
   * `data`. **Off by default** — prompt/response content is not persisted
   * automatically. Turn on only where retaining content is intended and safe.
   */
  logContent?: boolean;
  /** Character cap for a content preview when `logContent` is on. */
  previewChars?: number;
}

/**
 * Decorator that records structured audit events around any `ModelProvider`
 * without changing the provider-neutral contract:
 *
 * - `model_provider_requested`   — a provider call is about to be made
 * - `model_execution_started`    — request dispatched
 * - `model_execution_completed`  — response received (with usage + sizes)
 * - `model_execution_failed`     — the call threw
 *
 * It never records API keys, authorization headers, or other credentials.
 * Correlation ids (`taskId` / `agentId` / `projectId`) are read from
 * `request.metadata` when present so model calls can be tied back to a task.
 */
export class AuditedModelProvider implements ModelProvider {
  readonly id: string;
  private readonly inner: ModelProvider;
  private readonly audit: AuditLog;
  private readonly logContent: boolean;
  private readonly previewChars: number;

  constructor(
    inner: ModelProvider,
    audit: AuditLog,
    options: AuditedModelProviderOptions = {},
  ) {
    this.inner = inner;
    this.audit = audit;
    this.id = inner.id;
    this.logContent = options.logContent ?? false;
    this.previewChars = options.previewChars ?? 200;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const correlation = this.correlation(request);
    const requestedModel = request.model ?? null;

    this.audit.record("model_provider_requested", {
      ...correlation,
      data: { provider: this.inner.id, model: requestedModel },
    });
    this.audit.record("model_execution_started", {
      ...correlation,
      data: {
        provider: this.inner.id,
        model: requestedModel,
        messageCount: request.messages.length,
        ...(this.logContent
          ? {
              promptPreview: this.preview(
                request.messages
                  .map((m) => `${m.role}: ${m.content}`)
                  .join("\n"),
              ),
            }
          : {}),
      },
    });

    try {
      const response = await this.inner.generate(request);
      this.audit.record("model_execution_completed", {
        ...correlation,
        data: {
          provider: this.inner.id,
          model: response.model,
          usage: response.usage ?? null,
          contentChars: response.content.length,
          ...(this.logContent
            ? { completionPreview: this.preview(response.content) }
            : {}),
        },
      });
      return response;
    } catch (error) {
      this.audit.record("model_execution_failed", {
        ...correlation,
        data: {
          provider: this.inner.id,
          model: requestedModel,
          errorType: error instanceof Error ? error.name : "unknown",
          error: error instanceof Error ? error.message : String(error),
          status:
            error instanceof ProviderError ? (error.status ?? null) : null,
          retryable: error instanceof ProviderError ? error.retryable : false,
        },
      });
      throw error;
    }
  }

  private correlation(request: ModelRequest): {
    taskId?: string;
    agentId?: string;
    projectId?: string;
  } {
    const meta = request.metadata ?? {};
    const out: { taskId?: string; agentId?: string; projectId?: string } = {};
    if (typeof meta.taskId === "string") out.taskId = meta.taskId;
    if (typeof meta.agentId === "string") out.agentId = meta.agentId;
    if (typeof meta.projectId === "string") out.projectId = meta.projectId;
    return out;
  }

  private preview(text: string): string {
    return text.length > this.previewChars
      ? `${text.slice(0, this.previewChars)}…`
      : text;
  }
}
