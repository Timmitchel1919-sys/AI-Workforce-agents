/**
 * OpenAI adapter. This is the only production module aware of the OpenAI SDK
 * or Responses API shapes. The Workforce uses provider-neutral contracts.
 */
import {
  type ModelRequest,
  type ModelResponse,
  type StructuredModelProvider,
  type StructuredModelRequest,
  ProviderAuthError,
  ProviderConfigError,
  ProviderError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderResponseError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from "../../contracts/index.js";

export const OPENAI_PROVIDER_ID = "openai";
export const DEFAULT_OPENAI_TIMEOUT_MS = 30_000;
export const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 1_024;
export const DEFAULT_OPENAI_MAX_RETRIES = 0;

type EnvLike = Record<string, string | undefined>;

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxRetries: number;
}

export interface OpenAIConfigInput {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
}

export interface OpenAIResponseParams {
  model: string;
  instructions?: string;
  input: string;
  maxOutputTokens: number;
  schema?: { name: string; schema: Record<string, unknown> };
}

export interface RawOpenAIResponse {
  output_text?: unknown;
  model?: unknown;
  usage?: unknown;
  _request_id?: unknown;
}

export interface OpenAIResponsesTransport {
  create(
    params: OpenAIResponseParams,
    options: { signal: AbortSignal },
  ): Promise<RawOpenAIResponse>;
}

export function loadOpenAIConfig(
  input: OpenAIConfigInput = {},
  env: EnvLike = safeProcessEnv(),
): OpenAIConfig {
  const apiKey = (input.apiKey ?? env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new ProviderConfigError(
      OPENAI_PROVIDER_ID,
      "provider configuration unavailable: set OPENAI_API_KEY",
    );
  }
  const model = (input.model ?? env.OPENAI_MODEL ?? "").trim();
  if (!model) {
    throw new ProviderConfigError(
      OPENAI_PROVIDER_ID,
      "provider configuration unavailable: set OPENAI_MODEL",
    );
  }
  return {
    apiKey,
    model,
    timeoutMs: readInt(
      input.timeoutMs,
      env.OPENAI_TIMEOUT_MS,
      "OPENAI_TIMEOUT_MS",
      DEFAULT_OPENAI_TIMEOUT_MS,
      1,
    ),
    maxOutputTokens: readInt(
      input.maxOutputTokens,
      env.OPENAI_MAX_OUTPUT_TOKENS,
      "OPENAI_MAX_OUTPUT_TOKENS",
      DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
      1,
    ),
    maxRetries: readInt(
      input.maxRetries,
      env.OPENAI_MAX_RETRIES,
      "OPENAI_MAX_RETRIES",
      DEFAULT_OPENAI_MAX_RETRIES,
      0,
    ),
  };
}

export class OpenAIModelProvider implements StructuredModelProvider {
  readonly id = OPENAI_PROVIDER_ID;
  private transportPromise: Promise<OpenAIResponsesTransport> | undefined;
  private readonly config: OpenAIConfig;

  constructor(
    config: OpenAIConfigInput = {},
    private readonly options: {
      env?: EnvLike;
      transport?: OpenAIResponsesTransport;
    } = {},
  ) {
    this.config = loadOpenAIConfig(config, options.env ?? safeProcessEnv());
  }

  describe(): Omit<OpenAIConfig, "apiKey"> & { provider: string } {
    const { apiKey: _apiKey, ...safe } = this.config;
    return { provider: this.id, ...safe };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    return this.request(request, undefined);
  }

  async generateStructured(
    request: StructuredModelRequest,
  ): Promise<ModelResponse> {
    if (
      !request.schemaName.trim() ||
      !request.schema ||
      typeof request.schema !== "object"
    ) {
      throw new ProviderRequestError(
        OPENAI_PROVIDER_ID,
        "structured request requires a schema name and schema",
      );
    }
    return this.request(request, {
      name: request.schemaName,
      schema: request.schema,
    });
  }

  private async request(
    request: ModelRequest,
    schema: OpenAIResponseParams["schema"],
  ): Promise<ModelResponse> {
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
      throw new ProviderRequestError(
        OPENAI_PROVIDER_ID,
        "request must contain a user or assistant message",
      );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const raw = await (
        await this.transport()
      ).create(
        {
          model: this.config.model,
          ...(system ? { instructions: system } : {}),
          input,
          maxOutputTokens: this.config.maxOutputTokens,
          ...(schema ? { schema } : {}),
        },
        { signal: controller.signal },
      );
      return mapOpenAIResponse(raw, this.config.model);
    } catch (error) {
      throw mapOpenAIError(
        error,
        this.config.apiKey,
        controller.signal.aborted,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private transport(): Promise<OpenAIResponsesTransport> {
    if (this.options.transport) return Promise.resolve(this.options.transport);
    if (!this.transportPromise)
      this.transportPromise = createRealOpenAITransport(this.config);
    return this.transportPromise;
  }
}

export async function createRealOpenAITransport(
  config: OpenAIConfig,
): Promise<OpenAIResponsesTransport> {
  const mod = await import("openai");
  const client = new mod.default({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
  return {
    async create(params, options) {
      return client.responses.create(
        {
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
        },
        { signal: options.signal, maxRetries: config.maxRetries },
      ) as unknown as Promise<RawOpenAIResponse>;
    },
  };
}

export function mapOpenAIResponse(
  raw: RawOpenAIResponse,
  fallbackModel: string,
): ModelResponse {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.output_text !== "string" ||
    !raw.output_text.trim()
  ) {
    throw new ProviderResponseError(
      OPENAI_PROVIDER_ID,
      "malformed response: expected non-empty output_text",
    );
  }
  const usage = raw.usage as
    | {
        input_tokens?: unknown;
        output_tokens?: unknown;
        total_tokens?: unknown;
      }
    | undefined;
  return {
    content: raw.output_text,
    model:
      typeof raw.model === "string" && raw.model ? raw.model : fallbackModel,
    usage: usage
      ? {
          inputTokens: numberOrUndefined(usage.input_tokens),
          outputTokens: numberOrUndefined(usage.output_tokens),
          totalTokens: numberOrUndefined(usage.total_tokens),
        }
      : undefined,
  };
}

export function mapOpenAIError(
  error: unknown,
  apiKey: string,
  aborted = false,
): ProviderError {
  if (error instanceof ProviderError) return error;
  const info = error as {
    status?: unknown;
    name?: unknown;
    message?: unknown;
  } | null;
  const status = typeof info?.status === "number" ? info.status : undefined;
  const name = typeof info?.name === "string" ? info.name : "";
  const detail = redact(
    typeof info?.message === "string" ? info.message : String(error),
    apiKey,
  );
  if (aborted || /Timeout|Abort/i.test(name + detail))
    return new ProviderTimeoutError(OPENAI_PROVIDER_ID, "request timed out", {
      status,
      retryable: false,
    });
  if (
    status === 401 ||
    status === 403 ||
    /Authentication|Permission/i.test(name)
  )
    return new ProviderAuthError(
      OPENAI_PROVIDER_ID,
      `authentication failed: ${detail}`,
      { status, retryable: false },
    );
  if (status === 429 || /RateLimit/i.test(name))
    return new ProviderRateLimitError(
      OPENAI_PROVIDER_ID,
      `rate limited: ${detail}`,
      { status, retryable: false },
    );
  if (status === 400 || status === 404 || status === 422)
    return new ProviderRequestError(
      OPENAI_PROVIDER_ID,
      `invalid request: ${detail}`,
      { status, retryable: false },
    );
  if (
    (status !== undefined && status >= 500) ||
    /Connection|network|ECONN|ENOTFOUND/i.test(name + detail)
  )
    return new ProviderUnavailableError(
      OPENAI_PROVIDER_ID,
      `provider unavailable: ${detail}`,
      { status, retryable: false },
    );
  return new ProviderError(OPENAI_PROVIDER_ID, `provider failure: ${detail}`, {
    status,
    retryable: false,
  });
}

function safeProcessEnv(): EnvLike {
  return (globalThis as { process?: { env?: EnvLike } }).process?.env ?? {};
}
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
function redact(value: string, secret: string): string {
  return secret.length >= 4
    ? value.split(secret).join("***REDACTED***")
    : value;
}
function readInt(
  explicit: number | undefined,
  env: string | undefined,
  name: string,
  fallback: number,
  min: number,
): number {
  const value = explicit ?? (env?.trim() ? Number(env) : fallback);
  if (!Number.isInteger(value) || value < min)
    throw new ProviderConfigError(
      OPENAI_PROVIDER_ID,
      `${name} must be an integer >= ${min}`,
    );
  return value;
}
