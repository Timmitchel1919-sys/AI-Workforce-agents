/**
 * OpenAI adapter. This is the only production module aware of the OpenAI SDK
 * or Responses API shapes. The Workforce uses provider-neutral contracts.
 */
import { ProviderAuthError, ProviderConfigError, ProviderError, ProviderRateLimitError, ProviderRequestError, ProviderResponseError, ProviderTimeoutError, ProviderUnavailableError, } from "../../contracts/index.js";
export const OPENAI_PROVIDER_ID = "openai";
export const DEFAULT_OPENAI_TIMEOUT_MS = 30_000;
export const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 1_024;
export const DEFAULT_OPENAI_MAX_RETRIES = 0;
export function loadOpenAIConfig(input = {}, env = safeProcessEnv()) {
    const apiKey = (input.apiKey ?? env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
        throw new ProviderConfigError(OPENAI_PROVIDER_ID, "provider configuration unavailable: set OPENAI_API_KEY");
    }
    const model = (input.model ?? env.OPENAI_MODEL ?? "").trim();
    if (!model) {
        throw new ProviderConfigError(OPENAI_PROVIDER_ID, "provider configuration unavailable: set OPENAI_MODEL");
    }
    return {
        apiKey,
        model,
        timeoutMs: readInt(input.timeoutMs, env.OPENAI_TIMEOUT_MS, "OPENAI_TIMEOUT_MS", DEFAULT_OPENAI_TIMEOUT_MS, 1),
        maxOutputTokens: readInt(input.maxOutputTokens, env.OPENAI_MAX_OUTPUT_TOKENS, "OPENAI_MAX_OUTPUT_TOKENS", DEFAULT_OPENAI_MAX_OUTPUT_TOKENS, 1),
        maxRetries: readInt(input.maxRetries, env.OPENAI_MAX_RETRIES, "OPENAI_MAX_RETRIES", DEFAULT_OPENAI_MAX_RETRIES, 0),
    };
}
export class OpenAIModelProvider {
    options;
    id = OPENAI_PROVIDER_ID;
    transportPromise;
    config;
    constructor(config = {}, options = {}) {
        this.options = options;
        this.config = loadOpenAIConfig(config, options.env ?? safeProcessEnv());
    }
    describe() {
        const { apiKey: _apiKey, ...safe } = this.config;
        return { provider: this.id, ...safe };
    }
    async generate(request) {
        return this.request(request, undefined);
    }
    async generateStructured(request) {
        if (!request.schemaName.trim() ||
            !request.schema ||
            typeof request.schema !== "object") {
            throw new ProviderRequestError(OPENAI_PROVIDER_ID, "structured request requires a schema name and schema");
        }
        return this.request(request, {
            name: request.schemaName,
            schema: request.schema,
        });
    }
    async request(request, schema) {
        const system = request.messages
            .filter((message) => message.role === "system")
            .map((message) => message.content)
            .join("\n\n")
            .trim();
        const input = request.messages
            .filter((message) => message.role !== "system")
            .map((message) => `${message.role}: ${message.content}`)
            .join("\n\n");
        if (!input)
            throw new ProviderRequestError(OPENAI_PROVIDER_ID, "request must contain a user or assistant message");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const raw = await (await this.transport()).create({
                model: this.config.model,
                ...(system ? { instructions: system } : {}),
                input,
                maxOutputTokens: this.config.maxOutputTokens,
                ...(schema ? { schema } : {}),
            }, { signal: controller.signal });
            return mapOpenAIResponse(raw, this.config.model);
        }
        catch (error) {
            throw mapOpenAIError(error, this.config.apiKey, controller.signal.aborted);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    transport() {
        if (this.options.transport)
            return Promise.resolve(this.options.transport);
        if (!this.transportPromise)
            this.transportPromise = createRealOpenAITransport(this.config);
        return this.transportPromise;
    }
}
export async function createRealOpenAITransport(config) {
    const mod = await import("openai");
    const client = new mod.default({
        apiKey: config.apiKey,
        timeout: config.timeoutMs,
        maxRetries: config.maxRetries,
    });
    return {
        async create(params, options) {
            return client.responses.create({
                model: params.model,
                ...(params.instructions ? { instructions: params.instructions } : {}),
                input: params.input,
                max_output_tokens: params.maxOutputTokens,
                ...(params.schema
                    ? {
                        text: {
                            format: {
                                type: "json_schema",
                                name: params.schema.name,
                                schema: params.schema.schema,
                                strict: true,
                            },
                        },
                    }
                    : {}),
            }, { signal: options.signal, maxRetries: config.maxRetries });
        },
    };
}
export function mapOpenAIResponse(raw, fallbackModel) {
    if (!raw ||
        typeof raw !== "object" ||
        typeof raw.output_text !== "string" ||
        !raw.output_text.trim()) {
        throw new ProviderResponseError(OPENAI_PROVIDER_ID, "malformed response: expected non-empty output_text");
    }
    const usage = raw.usage;
    return {
        content: raw.output_text,
        model: typeof raw.model === "string" && raw.model ? raw.model : fallbackModel,
        usage: usage
            ? {
                inputTokens: numberOrUndefined(usage.input_tokens),
                outputTokens: numberOrUndefined(usage.output_tokens),
                totalTokens: numberOrUndefined(usage.total_tokens),
            }
            : undefined,
    };
}
export function mapOpenAIError(error, apiKey, aborted = false) {
    if (error instanceof ProviderError)
        return error;
    const info = error;
    const status = typeof info?.status === "number" ? info.status : undefined;
    const name = typeof info?.name === "string" ? info.name : "";
    const detail = redact(typeof info?.message === "string" ? info.message : String(error), apiKey);
    if (aborted || /Timeout|Abort/i.test(name + detail))
        return new ProviderTimeoutError(OPENAI_PROVIDER_ID, "request timed out", {
            status,
            retryable: false,
        });
    if (status === 401 ||
        status === 403 ||
        /Authentication|Permission/i.test(name))
        return new ProviderAuthError(OPENAI_PROVIDER_ID, `authentication failed: ${detail}`, { status, retryable: false });
    if (status === 429 || /RateLimit/i.test(name))
        return new ProviderRateLimitError(OPENAI_PROVIDER_ID, `rate limited: ${detail}`, { status, retryable: false });
    if (status === 400 || status === 404 || status === 422)
        return new ProviderRequestError(OPENAI_PROVIDER_ID, `invalid request: ${detail}`, { status, retryable: false });
    if ((status !== undefined && status >= 500) ||
        /Connection|network|ECONN|ENOTFOUND/i.test(name + detail))
        return new ProviderUnavailableError(OPENAI_PROVIDER_ID, `provider unavailable: ${detail}`, { status, retryable: false });
    return new ProviderError(OPENAI_PROVIDER_ID, `provider failure: ${detail}`, {
        status,
        retryable: false,
    });
}
function safeProcessEnv() {
    return globalThis.process?.env ?? {};
}
function numberOrUndefined(value) {
    return typeof value === "number" ? value : undefined;
}
function redact(value, secret) {
    return secret.length >= 4
        ? value.split(secret).join("***REDACTED***")
        : value;
}
function readInt(explicit, env, name, fallback, min) {
    const value = explicit ?? (env?.trim() ? Number(env) : fallback);
    if (!Number.isInteger(value) || value < min)
        throw new ProviderConfigError(OPENAI_PROVIDER_ID, `${name} must be an integer >= ${min}`);
    return value;
}
