import { type ModelProvider, type ModelRequest, type ModelResponse } from "../../contracts/index.js";
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
export declare class AuditedModelProvider implements ModelProvider {
    readonly id: string;
    private readonly inner;
    private readonly audit;
    private readonly logContent;
    private readonly previewChars;
    constructor(inner: ModelProvider, audit: AuditLog, options?: AuditedModelProviderOptions);
    generate(request: ModelRequest): Promise<ModelResponse>;
    private correlation;
    private preview;
}
