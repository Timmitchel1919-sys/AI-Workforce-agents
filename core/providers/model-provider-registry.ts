import {
  type ModelProvider,
  NotFoundError,
  ValidationError,
} from "../../contracts/index.js";

export type ModelProviderFactory = () => ModelProvider;

/**
 * Provider-neutral registry / factory.
 *
 * Resolves `ModelProvider` instances by identifier ("anthropic", "openai",
 * "google", ...). It knows nothing about any concrete provider — the wiring
 * layer registers factories. A future provider plugs in by calling `register`,
 * with no change to core.
 */
export class ModelProviderRegistry {
  private readonly factories = new Map<string, ModelProviderFactory>();
  private readonly instances = new Map<string, ModelProvider>();

  register(id: string, factory: ModelProviderFactory): void {
    const key = this.normalize(id);
    if (this.factories.has(key)) {
      throw new ValidationError(`model provider already registered: ${key}`);
    }
    this.factories.set(key, factory);
  }

  has(id: string): boolean {
    return this.factories.has(this.normalize(id));
  }

  /** Registered provider ids, sorted. */
  list(): string[] {
    return [...this.factories.keys()].sort();
  }

  /** Resolve (and memoize) a provider instance by id. */
  resolve(id: string): ModelProvider {
    const key = this.normalize(id);
    const cached = this.instances.get(key);
    if (cached) return cached;

    const factory = this.factories.get(key);
    if (!factory) {
      const known = this.list().join(", ") || "none";
      throw new NotFoundError(
        `no model provider registered for "${key}" (registered: ${known})`,
      );
    }
    const provider = factory();
    this.instances.set(key, provider);
    return provider;
  }

  private normalize(id: string): string {
    const key = id.trim().toLowerCase();
    if (!key) throw new ValidationError("model provider id is required");
    return key;
  }
}
