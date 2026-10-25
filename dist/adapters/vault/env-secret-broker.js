/**
 * R8 (ADR-0034) — EnvSecretBroker / EnvSecretValueResolver.
 *
 * Production credentials for the Firebase deployment adapter (and future
 * network-enabled runners) ride through this broker. The actual values
 * come from server-side environment variables that Firebase Functions
 * injects from Google Secret Manager via `defineSecret(...)`; this broker
 * is the trusted boundary between those env vars and the rest of the
 * execution system.
 *
 * Invariants:
 *   - A `secret://<name>` reference maps deterministically to an env var
 *     name `AIW_SECRET_<normalized>` (upper-case, non-alphanumeric → `_`).
 *   - `describe()` reports availability WITHOUT returning the value.
 *   - `issueHandle()` binds the handle to one `CapabilityGrant` (its
 *     `grantId`), with the grant's expiry.
 *   - `resolve()` returns the raw value ONLY to a trusted provider
 *     adapter and is never serialized into argv, logs, receipts or audit.
 *   - A missing env var is a hard throw (`SECRET_UNAVAILABLE`), so
 *     downstream code fails CLOSED before touching the provider.
 */
import { createHmac } from "node:crypto";
import { ExecutionDeniedError, } from "../../contracts/index.js";
import { noopMetrics, } from "../../core/observability/index.js";
/** Env-var prefix. The whole mapping is public — no secret in the NAME. */
const ENV_PREFIX = "AIW_SECRET_";
/** Deterministic, injective-enough name normalization. */
export function envNameForSecret(ref) {
    const bareName = ref.replace(/^secret:\/\//, "");
    const normalized = bareName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "_")
        .slice(0, 64);
    return `${ENV_PREFIX}${normalized}`;
}
/**
 * Combined `SecretBroker` + `SecretValueResolver`. One instance per
 * composition root; shared between the execution system (handle issue) and
 * the release pipeline (credential resolve).
 */
export class EnvSecretBroker {
    env;
    handleKey;
    metrics;
    constructor(options = {}) {
        this.env = options.env ?? (() => process.env);
        this.handleKey =
            options.handleKey ??
                `${Date.now()}:${Math.random().toString(36).slice(2)}`;
        this.metrics = options.metrics ?? noopMetrics;
    }
    async describe(ref) {
        const name = envNameForSecret(ref);
        const value = this.env()[name];
        return { ref, available: typeof value === "string" && value.length > 0 };
    }
    async issueHandle(ref, grant) {
        // We require the grant to carry secret.reference.use. Anything else is
        // a composition bug; fail CLOSED rather than mint an over-broad handle.
        if (grant.capability !== "secret.reference.use") {
            throw new ExecutionDeniedError("CAPABILITY_NOT_GRANTED", "secret handle requires a secret.reference.use grant");
        }
        const { available } = await this.describe(ref);
        if (!available) {
            throw new ExecutionDeniedError("POLICY_DENIED", `secret ${ref} is not configured on this deployment`);
        }
        const handleId = createHmac("sha256", this.handleKey)
            .update(`${ref}\0${grant.grantId}`)
            .digest("hex")
            .slice(0, 32);
        return {
            handleId: `sh_${handleId}`,
            ref,
            grantId: grant.grantId,
            expiresAt: grant.expiresAt,
        };
    }
    /**
     * `SecretValueResolver` entry point used by the DeploymentOrchestrator.
     * The RAW value crosses the boundary ONLY to the orchestrator, which
     * places it in `DeploymentContext.credential`; the adapter then passes it
     * via `FIREBASE_TOKEN` env (never argv). A missing value throws so the
     * orchestrator aborts before any provider call.
     */
    async resolve(ref) {
        const name = envNameForSecret(ref);
        const value = this.env()[name];
        if (typeof value !== "string" || value.length === 0) {
            this.metrics.counter("secret_resolution_denied", { ref });
            throw new ExecutionDeniedError("POLICY_DENIED", `secret ${ref} is not configured on this deployment`);
        }
        this.metrics.counter("secret_resolution_ok", { ref });
        return value;
    }
}
