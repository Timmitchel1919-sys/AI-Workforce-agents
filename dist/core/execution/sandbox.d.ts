/**
 * Sandbox registry + secret broker defaults (EO-4.1).
 *
 * No sandbox provider is registered in production: provider availability is
 * never faked, so every pre-flight reports SANDBOX_UNAVAILABLE until a real
 * provider (local restricted process, Docker, Windows/macOS/cloud runner…)
 * is implemented and registered in a later EO.
 */
import { type ExecutionResourceLimits, type LimitEnforcementReport, type NetworkPolicy, type SandboxProvider, type SecretBroker, type SecretDescriptor, type SecretHandle, type SecretReference } from "../../contracts/index.js";
export declare class SandboxRegistry {
    private readonly providers;
    register(provider: SandboxProvider): void;
    get(providerId: string): SandboxProvider | undefined;
    /**
     * First provider (by id) that can serve the instance, enforces every
     * REQUIRED limit, isolates the filesystem and supports the network mode.
     */
    select(environmentInstanceId: string, network: NetworkPolicy): SandboxProvider | undefined;
}
/** Per-limit truth: `enforced` only when the provider actually enforces it. */
export declare function limitEnforcementFor(provider: SandboxProvider | undefined, limits: ExecutionResourceLimits): LimitEnforcementReport;
/**
 * Default broker: knows no secrets and issues no handles. Secrets stay
 * references until a real broker (e.g. Secret Manager-backed) is wired.
 */
export declare class DenyAllSecretBroker implements SecretBroker {
    describe(ref: SecretReference): Promise<SecretDescriptor>;
    issueHandle(): Promise<SecretHandle>;
}
