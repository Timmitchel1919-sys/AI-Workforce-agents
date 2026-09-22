import { type ModelProvider } from "../../contracts/index.js";
export type ModelProviderFactory = () => ModelProvider;
/**
 * Provider-neutral registry / factory.
 *
 * Resolves `ModelProvider` instances by identifier ("anthropic", "openai",
 * "google", ...). It knows nothing about any concrete provider — the wiring
 * layer registers factories. A future provider plugs in by calling `register`,
 * with no change to core.
 */
export declare class ModelProviderRegistry {
    private readonly factories;
    private readonly instances;
    register(id: string, factory: ModelProviderFactory): void;
    has(id: string): boolean;
    /** Registered provider ids, sorted. */
    list(): string[];
    /** Resolve (and memoize) a provider instance by id. */
    resolve(id: string): ModelProvider;
    private normalize;
}
