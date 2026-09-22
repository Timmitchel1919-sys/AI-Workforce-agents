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
import { type ModelProvider, type ModelRequest, type ModelResponse, ProviderError } from "../../contracts/index.js";
export declare const ANTHROPIC_PROVIDER_ID = "anthropic";
export declare const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
export declare const DEFAULT_ANTHROPIC_MAX_TOKENS = 1024;
export declare const DEFAULT_ANTHROPIC_TIMEOUT_MS = 60000;
export declare const DEFAULT_ANTHROPIC_MAX_RETRIES = 2;
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
export declare function loadAnthropicConfig(input?: AnthropicConfigInput, env?: EnvLike): AnthropicConfig;
/**
 * Replace any occurrence of a known secret with a marker. Applied to every
 * message the adapter derives from a provider failure, as defence in depth —
 * the adapter never interpolates the key itself.
 */
export declare function redactSecrets(text: string, secrets: readonly string[]): string;
export interface AnthropicMessageParams {
    model: string;
    maxTokens: number;
    system?: string;
    messages: ReadonlyArray<{
        role: "user" | "assistant";
        content: string;
    }>;
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
/**
 * Lazily construct a transport backed by the real SDK. Throws a clear
 * `ProviderConfigError` if `@anthropic-ai/sdk` is not installed.
 */
export declare function createRealAnthropicTransport(config: AnthropicConfig): Promise<AnthropicTransport>;
/**
 * Map an Anthropic SDK / API failure onto the Workforce provider-error
 * hierarchy. Diagnostic detail (message, status) is preserved; the API key is
 * redacted from every message. A value that is already a `ProviderError`
 * passes through untouched.
 */
export declare function mapAnthropicError(error: unknown, apiKey: string): ProviderError;
export interface AnthropicModelProviderOptions {
    /** Inject a transport (tests, or a custom HTTP layer). */
    transport?: AnthropicTransport;
    /** Environment source for config resolution. Defaults to `process.env`. */
    env?: EnvLike;
}
export declare class AnthropicModelProvider implements ModelProvider {
    readonly id = "anthropic";
    private readonly config;
    private injectedTransport;
    private transportInit;
    constructor(config?: AnthropicConfigInput, options?: AnthropicModelProviderOptions);
    /** The resolved configuration, minus the API key. Safe to log. */
    describe(): {
        provider: string;
        model: string;
        timeoutMs: number;
        maxTokens: number;
        maxRetries: number;
    };
    generate(request: ModelRequest): Promise<ModelResponse>;
    private getTransport;
}
/**
 * Convenience: register the Anthropic provider on a `ModelProviderRegistry`
 * without the registry (in core) needing to import this adapter. Call from the
 * wiring layer.
 */
export declare function anthropicFactory(config?: AnthropicConfigInput, options?: AnthropicModelProviderOptions): () => AnthropicModelProvider;
export {};
