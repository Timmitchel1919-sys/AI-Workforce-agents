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
     * First provider that can serve the instance, enforces every REQUIRED
     * limit and supports the network mode — isolating providers first.
     *
     * Isolation is never assumed: an operation that reaches the workspace needs
     * filesystem isolation; one that reaches the network (or a policy that
     * allows hosts) needs enforced network isolation. A provider WITHOUT
     * isolation (a host process) is only eligible when the policy rule opts in
     * (`hostProcess`) AND the operation touches neither workspace nor network.
     */
    select(environmentInstanceId: string, network: NetworkPolicy, needs?: SandboxNeeds): SandboxProvider | undefined;
}
/** What an operation needs from a sandbox (all declared server-side). */
export interface SandboxNeeds {
    workspaceAccess: "none" | "read" | "write";
    networkAccess: "none" | "approved_hosts";
    /** Policy rule opted in to non-isolating host process providers. */
    hostProcessAllowed: boolean;
    /** EO-4.3: the executable the operation runs (provider must serve it). */
    executableId?: string;
    /** EO-4.4: what the operation executes. */
    executionClass?: "diagnostic" | "project_code" | "adapter";
    /** EO-4.4: policy rule accepted running project code on a host runner. */
    trustedHostBuildAllowed?: boolean;
    /** EO-4.5: the runner provider the adapter registry routed to (pinned). */
    requiredProviderId?: string;
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
