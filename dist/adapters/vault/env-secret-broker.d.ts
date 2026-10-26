import { type CapabilityGrant, type SecretBroker, type SecretDescriptor, type SecretHandle, type SecretReference } from "../../contracts/index.js";
import { type MetricsPort } from "../../core/observability/index.js";
import type { SecretValueResolver } from "../../core/release/source-control-orchestrator.js";
/** Deterministic, injective-enough name normalization. */
export declare function envNameForSecret(ref: SecretReference): string;
export interface EnvSecretBrokerOptions {
    /** For tests: a function returning the current env snapshot. */
    readonly env?: () => Readonly<Record<string, string | undefined>>;
    /**
     * Keyed HMAC base. In production, bound to a trusted deployment secret so
     * handleIds cannot be forged offline. Defaults to a per-process random.
     */
    readonly handleKey?: string;
    /** R11: optional observability port; emits sanitized counters. */
    readonly metrics?: MetricsPort;
}
/**
 * Combined `SecretBroker` + `SecretValueResolver`. One instance per
 * composition root; shared between the execution system (handle issue) and
 * the release pipeline (credential resolve).
 */
export declare class EnvSecretBroker implements SecretBroker, SecretValueResolver {
    private readonly env;
    private readonly handleKey;
    private readonly metrics;
    constructor(options?: EnvSecretBrokerOptions);
    describe(ref: SecretReference): Promise<SecretDescriptor>;
    issueHandle(ref: SecretReference, grant: CapabilityGrant): Promise<SecretHandle>;
    /**
     * `SecretValueResolver` entry point used by the DeploymentOrchestrator.
     * The RAW value crosses the boundary ONLY to the orchestrator, which
     * places it in `DeploymentContext.credential`; the adapter then passes it
     * via `FIREBASE_TOKEN` env (never argv). A missing value throws so the
     * orchestrator aborts before any provider call.
     */
    resolve(ref: SecretReference): Promise<string>;
}
