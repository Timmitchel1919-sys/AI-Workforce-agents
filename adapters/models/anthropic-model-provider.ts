/**
 * Anthropic model provider adapter.
 *
 * This module is the ONLY place that knows about the Anthropic SDK, its request
 * body shape, or its response / error structures. Everything above it works
 * against the provider-neutral `ModelProvider` contract.
 *
 * Credentials come from the environment (or an explicit config object) and are
 * never logged, embedded in thrown errors, or committed. The Anthropic SDK is
 * an optional peer dependency, loaded lazily only when a real transport is
 * needed; tests inject a stub transport and never touch it.
 */
import {
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  ProviderAuthError,
  ProviderConfigError,
  ProviderError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderResponseError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from "../../contracts/index.js";

export const ANTHROPIC_PROVIDER_ID = "anthropic";
export const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 1024;
export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 60_000;
export const DEFAULT_ANTHROPIC_MAX_RETRIES = 2;

/* ------------------------------------------------------------------ */
/* Configuration                                                      */
/* ------------------------------------------------------------------ */

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  maxRetries: number;
}

export interface AnthropicConfigInput {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  maxRetries?: number;
}

type EnvLike = Record<string, string | undefined>;

/**
 * Resolve a full config from an explicit input object, then environment
 * variables, then defaults — validating as it goes. Throws
 * `ProviderConfigError` (a `ValidationError`) with a clear, secret-free message
 * when a required value is missing or a numeric value is invalid.
 *
 *   ANTHROPIC_API_KEY      (required)
 *   ANTHROPIC_MODEL        (default: claude-3-5-sonnet-latest)
 *   ANTHROPIC_TIMEOUT_MS   (default: 60000)
 *   ANTHROPIC_MAX_TOKENS   (default: 1024)
 *   ANTHROPIC_MAX_RETRIES  (default: 2, may be 0)
 */
export function loadAnthropicConfig(
  input: AnthropicConfigInput = {},
  env: EnvLike = safeProcessEnv(),
): AnthropicConfig {
  const apiKey = (input.apiKey ?? env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new ProviderConfigError(
      ANTHROPIC_PROVIDER_ID,
      "missing API key: set ANTHROPIC_API_KEY or pass config.apiKey",
    );
  }

  const model = (
    input.model ??
    env.ANTHROPIC_MODEL ??
    DEFAULT_ANTHROPIC_MODEL
  ).trim();
  if (!model) {
    throw new ProviderConfigError(
      ANTHROPIC_PROVIDER_ID,
      "model identifier must not be blank",
    );
  }

  return {
    apiKey,
    model,
    timeoutMs: readInt(
      input.timeoutMs,
      env.ANTHROPIC_TIMEOUT_MS,
      "ANTHROPIC_TIMEOUT_MS",
      DEFAULT_ANTHROPIC_TIMEOUT_MS,
      1,
    ),
    maxTokens: readInt(
      input.maxTokens,
      env.ANTHROPIC_MAX_TOKENS,
      "ANTHROPIC_MAX_TOKENS",
      DEFAULT_ANTHROPIC_MAX_TOKENS,
      1,
    ),
    maxRetries: readInt(
      input.maxRetries,
      env.ANTHROPIC_MAX_RETRIES,
      "ANTHROPIC_MAX_RETRIES",
      DEFAULT_ANTHROPIC_MAX_RETRIES,
      0,
    ),
  };
}

function readInt(
  explicit: number | undefined,
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
): number {
  const bound = (value: number): number => {
    if (!Number.isInteger(value) || value < min) {
      throw new ProviderConfigError(
        ANTHROPIC_PROVIDER_ID,
        `${name} must be an integer >= ${min}`,
      );
    }
    return value;
  };
  if (explicit !== undefined) return bound(explicit);
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new ProviderConfigError(
      ANTHROPIC_PROVIDER_ID,
      `${name} must be a number`,
    );
  }
  return bound(parsed);
}

function safeProcessEnv(): EnvLike {
  try {
    return (globalThis as { process?: { env?: EnvLike } }).process?.env ?? {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Secret redaction                                                   */
/* ------------------------------------------------------------------ */

/**
 * Replace any occurrence of a known secret with a marker. Applied to every
 * message the adapter derives from a provider failure, as defence in depth —
 * the adapter never interpolates the key itself.
 */
export function redactSecrets(
  text: string,
  secrets: readonly string[],
): string {
  let out = text;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) {
      out = out.split(secret).join("***REDACTED***");
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Transport boundary                                                 */
/* ------------------------------------------------------------------ */

export interface AnthropicMessageParams {
  model: string;
  maxTokens: number;
  system?: string;
  messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
  metadata?: Record<string, unknown>;
}

/** The subset of an Anthropic `Message` the adapter reads. Deliberately loose. */
export interface RawAnthropicMessage {
  id?: unknown;
  model?: unknown;
  content?: unknown;
  stop_reason?: unknown;
  usage?: unknown;
}

/**
 * The thin seam between this adapter and the Anthropic SDK. The real
 * implementation wraps `client.messages.create`; tests provide a stub.
 */
export interface AnthropicTransport {
  createMessage(params: AnthropicMessageParams): Promise<RawAnthropicMessage>;
}

interface AnthropicClientLike {
  messages: {
    create(body: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }): Promise<unknown>;
  };
}

/**
 * Lazily construct a transport backed by the real SDK. Throws a clear
 * `ProviderConfigError` if `@anthropic-ai/sdk` is not installed.
 */
export async function createRealAnthropicTransport(
  config: AnthropicConfig,
): Promise<AnthropicTransport> {
  let mod: { default?: new (options: unknown) => AnthropicClientLike } | null;
  try {
    mod = (await import("@anthropic-ai/sdk")) as unknown as {
      default?: new (options: unknown) => AnthropicClientLike;
    };
  } catch {
    mod = null;
  }
  if (!mod?.default) {
    throw new ProviderConfigError(
      ANTHROPIC_PROVIDER_ID,
      "the '@anthropic-ai/sdk' package is not installed; run: npm install @anthropic-ai/sdk",
    );
  }

  const AnthropicClient = mod.default;
  const client = new AnthropicClient({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  });

  return {
    async createMessage(params: AnthropicMessageParams) {
      const message = await client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens,
        messages: params.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        ...(params.system ? { system: params.system } : {}),
      });
      return message as RawAnthropicMessage;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Error mapping                                                      */
/* ------------------------------------------------------------------ */

/**
 * Map an Anthropic SDK / API failure onto the Workforce provider-error
 * hierarchy. Diagnostic detail (message, status) is preserved; the API key is
 * redacted from every message. A value that is already a `ProviderError`
 * passes through untouched.
 */
export function mapAnthropicError(
  error: unknown,
  apiKey: string,
): ProviderError {
  if (error instanceof ProviderError) return error;

  const info = error as {
    status?: unknown;
    name?: unknown;
    message?: unknown;
  } | null;
  const status = typeof info?.status === "number" ? info.status : undefined;
  const name = typeof info?.name === "string" ? info.name : "";
  const rawMessage =
    typeof info?.message === "string" && info.message
      ? info.message
      : String(error);
  const detail = redactSecrets(rawMessage, [apiKey]);

  if (
    status === 401 ||
    status === 403 ||
    /Authentication|Permission/i.test(name)
  ) {
    return new ProviderAuthError(
      ANTHROPIC_PROVIDER_ID,
      `authentication failed: ${detail}`,
      { status, retryable: false },
    );
  }
  if (status === 429 || /RateLimit/i.test(name)) {
    return new ProviderRateLimitError(
      ANTHROPIC_PROVIDER_ID,
      `rate limited: ${detail}`,
      { status, retryable: true },
    );
  }
  if (status === 408 || /Timeout/i.test(name)) {
    return new ProviderTimeoutError(
      ANTHROPIC_PROVIDER_ID,
      `request timed out: ${detail}`,
      { status, retryable: true },
    );
  }
  if (
    /Connection|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(name + detail)
  ) {
    return new ProviderUnavailableError(
      ANTHROPIC_PROVIDER_ID,
      `provider unreachable: ${detail}`,
      { status, retryable: true },
    );
  }
  if (status !== undefined && status >= 500) {
    return new ProviderUnavailableError(
      ANTHROPIC_PROVIDER_ID,
      `provider error: ${detail}`,
      { status, retryable: true },
    );
  }
  if (
    status === 400 ||
    status === 422 ||
    /BadRequest|UnprocessableEntity|InvalidRequest/i.test(name)
  ) {
    return new ProviderRequestError(
      ANTHROPIC_PROVIDER_ID,
      `invalid request: ${detail}`,
      { status, retryable: false },
    );
  }
  return new ProviderError(
    ANTHROPIC_PROVIDER_ID,
    `provider failure: ${detail}`,
    { status, retryable: false },
  );
}

/* ------------------------------------------------------------------ */
/* Response mapping                                                   */
/* ------------------------------------------------------------------ */

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
  return (
    !!block &&
    typeof block === "object" &&
    (block as { type?: unknown }).type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
  );
}

function mapResponse(
  raw: RawAnthropicMessage,
  fallbackModel: string,
): ModelResponse {
  if (!raw || typeof raw !== "object") {
    throw new ProviderResponseError(
      ANTHROPIC_PROVIDER_ID,
      "malformed response: not an object",
    );
  }
  if (!Array.isArray(raw.content)) {
    throw new ProviderResponseError(
      ANTHROPIC_PROVIDER_ID,
      "malformed response: `content` is not an array",
    );
  }
  const textBlocks = raw.content.filter(isTextBlock);
  if (textBlocks.length === 0) {
    throw new ProviderResponseError(
      ANTHROPIC_PROVIDER_ID,
      "malformed response: no text content blocks",
    );
  }

  const model =
    typeof raw.model === "string" && raw.model ? raw.model : fallbackModel;

  const usageRaw = raw.usage as
    { input_tokens?: unknown; output_tokens?: unknown } | null | undefined;
  const usage =
    usageRaw && typeof usageRaw === "object"
      ? {
          inputTokens:
            typeof usageRaw.input_tokens === "number"
              ? usageRaw.input_tokens
              : undefined,
          outputTokens:
            typeof usageRaw.output_tokens === "number"
              ? usageRaw.output_tokens
              : undefined,
        }
      : undefined;

  return {
    content: textBlocks.map((block) => block.text).join(""),
    model,
    usage,
  };
}

/* ------------------------------------------------------------------ */
/* Provider                                                           */
/* ------------------------------------------------------------------ */

export interface AnthropicModelProviderOptions {
  /** Inject a transport (tests, or a custom HTTP layer). */
  transport?: AnthropicTransport;
  /** Environment source for config resolution. Defaults to `process.env`. */
  env?: EnvLike;
}

export class AnthropicModelProvider implements ModelProvider {
  readonly id = ANTHROPIC_PROVIDER_ID;
  private readonly config: AnthropicConfig;
  private injectedTransport: AnthropicTransport | undefined;
  private transportInit: Promise<AnthropicTransport> | undefined;

  constructor(
    config: AnthropicConfigInput = {},
    options: AnthropicModelProviderOptions = {},
  ) {
    this.config = options.env
      ? loadAnthropicConfig(config, options.env)
      : loadAnthropicConfig(config);
    this.injectedTransport = options.transport;
  }

  /** The resolved configuration, minus the API key. Safe to log. */
  describe(): {
    provider: string;
    model: string;
    timeoutMs: number;
    maxTokens: number;
    maxRetries: number;
  } {
    return {
      provider: this.id,
      model: this.config.model,
      timeoutMs: this.config.timeoutMs,
      maxTokens: this.config.maxTokens,
      maxRetries: this.config.maxRetries,
    };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (
      !request ||
      !Array.isArray(request.messages) ||
      request.messages.length === 0
    ) {
      throw new ProviderRequestError(
        ANTHROPIC_PROVIDER_ID,
        "request.messages must be a non-empty array",
      );
    }

    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n")
      .trim();
    const messages = request.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    if (messages.length === 0) {
      throw new ProviderRequestError(
        ANTHROPIC_PROVIDER_ID,
        "request must contain at least one user or assistant message",
      );
    }

    const params: AnthropicMessageParams = {
      model: request.model?.trim() || this.config.model,
      maxTokens: this.config.maxTokens,
      messages,
      ...(system ? { system } : {}),
      ...(request.metadata ? { metadata: request.metadata } : {}),
    };

    let transport: AnthropicTransport;
    try {
      transport = await this.getTransport();
    } catch (error) {
      if (
        error instanceof ProviderError ||
        error instanceof ProviderConfigError
      ) {
        throw error;
      }
      throw mapAnthropicError(error, this.config.apiKey);
    }

    let raw: RawAnthropicMessage;
    try {
      raw = await transport.createMessage(params);
    } catch (error) {
      throw mapAnthropicError(error, this.config.apiKey);
    }

    return mapResponse(raw, params.model);
  }

  private getTransport(): Promise<AnthropicTransport> {
    if (this.injectedTransport) return Promise.resolve(this.injectedTransport);
    if (!this.transportInit) {
      this.transportInit = createRealAnthropicTransport(this.config);
    }
    return this.transportInit;
  }
}

/**
 * Convenience: register the Anthropic provider on a `ModelProviderRegistry`
 * without the registry (in core) needing to import this adapter. Call from the
 * wiring layer.
 */
export function anthropicFactory(
  config: AnthropicConfigInput = {},
  options: AnthropicModelProviderOptions = {},
): () => AnthropicModelProvider {
  return () => new AnthropicModelProvider(config, options);
}
