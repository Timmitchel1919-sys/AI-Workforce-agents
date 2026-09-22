/**
 * OpenAI adapter. This is the only production module aware of the OpenAI SDK
 * or Responses API shapes. The Workforce uses provider-neutral contracts.
 */
import { type ModelRequest, type ModelResponse, type StructuredModelProvider, type StructuredModelRequest, ProviderError } from "../../contracts/index.js";
export declare const OPENAI_PROVIDER_ID = "openai";
export declare const DEFAULT_OPENAI_TIMEOUT_MS = 30000;
export declare const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 1024;
export declare const DEFAULT_OPENAI_MAX_RETRIES = 0;
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
    schema?: {
        name: string;
        schema: Record<string, unknown>;
    };
}
export interface RawOpenAIResponse {
    output_text?: unknown;
    model?: unknown;
    usage?: unknown;
    _request_id?: unknown;
}
export interface OpenAIResponsesTransport {
    create(params: OpenAIResponseParams, options: {
        signal: AbortSignal;
    }): Promise<RawOpenAIResponse>;
}
export declare function loadOpenAIConfig(input?: OpenAIConfigInput, env?: EnvLike): OpenAIConfig;
export declare class OpenAIModelProvider implements StructuredModelProvider {
    private readonly options;
    readonly id = "openai";
    private transportPromise;
    private readonly config;
    constructor(config?: OpenAIConfigInput, options?: {
        env?: EnvLike;
        transport?: OpenAIResponsesTransport;
    });
    describe(): Omit<OpenAIConfig, "apiKey"> & {
        provider: string;
    };
    generate(request: ModelRequest): Promise<ModelResponse>;
    generateStructured(request: StructuredModelRequest): Promise<ModelResponse>;
    private request;
    private transport;
}
export declare function createRealOpenAITransport(config: OpenAIConfig): Promise<OpenAIResponsesTransport>;
export declare function mapOpenAIResponse(raw: RawOpenAIResponse, fallbackModel: string): ModelResponse;
export declare function mapOpenAIError(error: unknown, apiKey: string, aborted?: boolean): ProviderError;
export {};
