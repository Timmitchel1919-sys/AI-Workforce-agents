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
     * First provider that can serve the instance, enforces every REQUIRED
     * limit and supports the network mode — isolating providers first.
     *
     * Isolation is never assumed: an operation that reaches the workspace needs
     * filesystem isolation; one that reaches the network (or a policy that
     * allows hosts) needs enforced network isolation. A provider WITHOUT
     * isolation (a host process) is only eligible when the policy rule opts in
     * (`hostProcess`) AND the operation touches neither workspace nor network.
     */
    select(environmentInstanceId, network, needs = DEFAULT_NEEDS) {
        const isolation = (p) => Number(p.capabilities.filesystemIsolation) +
            Number(p.capabilities.networkIsolation);
        return [...this.providers.values()]
            .sort((a, b) => isolation(b) - isolation(a) ||
            a.providerId.localeCompare(b.providerId))
            .find((p) => {
            const caps = p.capabilities;
            // EO-4.5: routed runner bridges are pinned; everything else is not.
            if (needs.requiredProviderId !== undefined) {
                if (p.providerId !== needs.requiredProviderId)
                    return false;
            }
            else if (caps.requiresRouting) {
                return false;
            }
            if (!p.isAvailableFor(environmentInstanceId))
                return false;
            if (needs.executableId !== undefined &&
                caps.executables !== undefined &&
                !caps.executables.includes(needs.executableId)) {
                return false;
            }
            if (!caps.networkModes.includes(network.mode))
                return false;
            if (!REQUIRED_LIMIT_KEYS.every((k) => caps.enforcedLimits.includes(k))) {
                return false;
            }
            const needsNetwork = network.mode !== "deny_all" || needs.networkAccess !== "none";
            if (needsNetwork && !caps.networkIsolation)
                return false;
            if (caps.filesystemIsolation && caps.networkIsolation)
                return true;
            // Non-isolating providers — only with an explicit policy opt-in:
            // (a) host diagnostics: no workspace, no network (EO-4.2);
            if (needs.hostProcessAllowed &&
                !caps.workspaceExecution &&
                needs.workspaceAccess === "none" &&
                needs.networkAccess === "none") {
                return true;
            }
            // (b) EO-4.4 trusted host build: the project's own build/test code,
            //     run inside the workspace root, no network access requested.
            return (needs.trustedHostBuildAllowed === true &&
                needs.executionClass === "project_code" &&
                caps.workspaceExecution === true &&
                needs.networkAccess === "none");
        });
    }
}
const DEFAULT_NEEDS = {
    workspaceAccess: "write",
    networkAccess: "none",
    hostProcessAllowed: false,
};
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
