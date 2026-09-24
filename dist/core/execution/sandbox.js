/**
 * Sandbox registry + secret broker defaults (EO-4.1).
 *
 * No sandbox provider is registered in production: provider availability is
 * never faked, so every pre-flight reports SANDBOX_UNAVAILABLE until a real
 * provider (local restricted process, Docker, Windows/macOS/cloud runner…)
 * is implemented and registered in a later EO.
 */
import { OPTIONAL_LIMIT_KEYS, REQUIRED_LIMIT_KEYS, ExecutionDeniedError, } from "../../contracts/index.js";
export class SandboxRegistry {
    providers = new Map();
    register(provider) {
        if (this.providers.has(provider.providerId)) {
            throw new Error(`sandbox provider ${provider.providerId} is already registered`);
        }
        this.providers.set(provider.providerId, provider);
    }
    get(providerId) {
        return this.providers.get(providerId);
    }
    /**
     * First provider (by id) that can serve the instance, enforces every
     * REQUIRED limit, isolates the filesystem and supports the network mode.
     */
    select(environmentInstanceId, network) {
        return [...this.providers.values()]
            .sort((a, b) => a.providerId.localeCompare(b.providerId))
            .find((p) => p.isAvailableFor(environmentInstanceId) &&
            p.capabilities.filesystemIsolation &&
            p.capabilities.networkModes.includes(network.mode) &&
            REQUIRED_LIMIT_KEYS.every((k) => p.capabilities.enforcedLimits.includes(k)));
    }
}
/** Per-limit truth: `enforced` only when the provider actually enforces it. */
export function limitEnforcementFor(provider, limits) {
    const report = {};
    for (const key of [...REQUIRED_LIMIT_KEYS, ...OPTIONAL_LIMIT_KEYS]) {
        if (limits[key] === undefined)
            continue;
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
export class DenyAllSecretBroker {
    async describe(ref) {
        return { ref, available: false };
    }
    async issueHandle() {
        throw new ExecutionDeniedError("POLICY_DENIED", "no secret broker is configured; secret handles cannot be issued");
    }
}
