/**
 * Production verification (EO-6.1): the explicit stage AFTER a deployment.
 *
 *   DEPLOYED != HEALTHY.  A successful deploy command only means the provider accepted the
 *   release. This module asks the running system whether it is actually healthy and is actually
 *   the build that was meant to ship.
 *
 * It is an injectable HTTP checker: it holds no credentials, does not follow redirects, sends no
 * authentication, and performs only GET requests. Every check ends `passed` or `failed` — a check
 * that could not be performed is `failed` (UNKNOWN != HEALTHY), never silently skipped. The verdict
 * is `healthy` only when EVERY check passed.
 */
export type ProductionCheckStatus = "passed" | "failed";
export interface ProductionCheck {
    id: string;
    /** What was checked (an origin + path, never a credential or a header value). */
    subject: string;
    status: ProductionCheckStatus;
    detail: string;
}
export interface ProductionVerificationReport {
    /** `healthy` only if every check passed; anything else is `unhealthy`. */
    verdict: "healthy" | "unhealthy";
    checkedAt: string;
    baseUrls: readonly string[];
    checks: readonly ProductionCheck[];
    /** UI build identity (main script asset) served by each origin, when it could be read. */
    bundles: Readonly<Record<string, string>>;
    /**
     * Build/version identity each origin's health endpoint REPORTS (`{"version": …}`). This is what
     * production says about itself — never what the caller believes it deployed.
     */
    servedVersions: Readonly<Record<string, string>>;
}
export interface ProductionVerificationInput {
    /** Origins to verify. Each must be an https origin on an allowed host. */
    baseUrls: readonly string[];
    /** Hosts a verification may contact (suffix match on a dot boundary). Default: Firebase Hosting. */
    allowedHostSuffixes?: readonly string[];
    /** Routes that must DENY an unauthenticated caller (401/403, JSON, not cacheable). At least one. */
    protectedPaths?: readonly string[];
    /** Health route. Default `/api/health`. */
    healthPath?: string;
    /** Every origin must serve exactly this UI script asset (e.g. `assets/index-abc.js`). */
    expectedBundle?: string;
    /** Every origin's health endpoint must report exactly this version (e.g. the commit SHA). */
    expectedVersion?: string;
    /** API responses that carry per-operator data must not be cacheable. Default true. */
    requireNoStore?: boolean;
    fetch?: typeof fetch;
    clock?: () => string;
    /** Timeout for a whole request INCLUDING reading its body. Default 15 000 ms. */
    timeoutMs?: number;
}
/** A strict https origin on an allowed host, with no credentials, port, path, query or fragment. */
export declare function parseOrigin(raw: string, allowedHostSuffixes?: readonly string[]): URL | undefined;
export declare function verifyProduction(input: ProductionVerificationInput): Promise<ProductionVerificationReport>;
/**
 * Adapts a report to the deployment orchestrator's post-deploy contract, so a real deployment
 * adapter can use this verifier for its `verify()` step.
 *
 *  - `reachable` is true only if EVERY check except the version comparison passed (hosting, health,
 *    protected routes, unknown-route): a production that is up but exposes an open route, or serves
 *    a broken page, is not reachable-and-healthy. Version is compared separately by the
 *    orchestrator against the candidate, from what production REPORTS.
 *  - `reportedVersion` comes only from the report (what the health endpoints say). It is never a
 *    value the caller supplies, so the orchestrator can never compare a commit to itself. If the
 *    origins disagree, or none reports a version, no version is reported and the release cannot
 *    be marked healthy.
 */
export declare function toPostDeployVerification(report: ProductionVerificationReport): {
    reachable: boolean;
    reportedVersion?: string;
    detail: string;
};
