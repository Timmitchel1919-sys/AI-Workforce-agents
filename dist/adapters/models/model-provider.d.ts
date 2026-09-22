/**
 * Model provider adapter boundary.
 *
 * The core Workforce never imports a vendor SDK. Concrete providers (OpenAI,
 * Anthropic, Google, ...) implement `ModelProvider` and are injected at wiring
 * time. `EchoModelProvider` is a deterministic in-process double used by tests
 * and local wiring — it performs no network I/O.
 */
import type { ModelProvider, ModelRequest, ModelResponse } from "../../contracts/index.js";
export type { ModelProvider, ModelRequest, ModelResponse, ModelMessage, } from "../../contracts/index.js";
export declare class EchoModelProvider implements ModelProvider {
    readonly id: string;
    constructor(id?: string);
    generate(request: ModelRequest): Promise<ModelResponse>;
}
