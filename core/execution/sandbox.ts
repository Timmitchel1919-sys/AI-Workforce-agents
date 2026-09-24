/**
 * Sandbox registry + secret broker defaults (EO-4.1).
 *
 * No sandbox provider is registered in production: provider availability is
 * never faked, so every pre-flight reports SANDBOX_UNAVAILABLE until a real
 * provider (local restricted process, Docker, Windows/macOS/cloud runner…)
 * is implemented and registered in a later EO.
 */
import {
  OPTIONAL_LIMIT_KEYS,
  REQUIRED_LIMIT_KEYS,
  type ExecutionResourceLimits,
  type LimitEnforcementReport,
  type NetworkPolicy,
  type SandboxProvider,
  type SecretBroker,
  type SecretDescriptor,
  type SecretHandle,
  type SecretReference,
  ExecutionDeniedError,
} from "../../contracts/index.js";

export class SandboxRegistry {
  private readonly providers = new Map<string, SandboxProvider>();

  register(provider: SandboxProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(
        `sandbox provider ${provider.providerId} is already registered`,
      );
    }
    this.providers.set(provider.providerId, provider);
  }

  get(providerId: string): SandboxProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * First provider (by id) that can serve the instance, enforces every
   * REQUIRED limit, isolates the filesystem and supports the network mode.
   */
  select(
    environmentInstanceId: string,
    network: NetworkPolicy,
  ): SandboxProvider | undefined {
    return [...this.providers.values()]
      .sort((a, b) => a.providerId.localeCompare(b.providerId))
      .find(
        (p) =>
          p.isAvailableFor(environmentInstanceId) &&
          p.capabilities.filesystemIsolation &&
          p.capabilities.networkModes.includes(network.mode) &&
          REQUIRED_LIMIT_KEYS.every((k) =>
            p.capabilities.enforcedLimits.includes(k),
          ),
      );
  }
}

/** Per-limit truth: `enforced` only when the provider actually enforces it. */
export function limitEnforcementFor(
  provider: SandboxProvider | undefined,
  limits: ExecutionResourceLimits,
): LimitEnforcementReport {
  const report: LimitEnforcementReport = {};
  for (const key of [...REQUIRED_LIMIT_KEYS, ...OPTIONAL_LIMIT_KEYS]) {
    if (limits[key] === undefined) continue;
    report[key] = provider?.capabilities.enforcedLimits.includes(key)
      ? "enforced"
      : "unsupported";
  }
  return report;
}

/**
 * Default broker: knows no secrets and issues no handles. Secrets stay
 * references until a real broker (e.g. Secret Manager-backed) is wired.
 */
export class DenyAllSecretBroker implements SecretBroker {
  async describe(ref: SecretReference): Promise<SecretDescriptor> {
    return { ref, available: false };
  }

  async issueHandle(): Promise<SecretHandle> {
    throw new ExecutionDeniedError(
      "POLICY_DENIED",
      "no secret broker is configured; secret handles cannot be issued",
    );
  }
}
