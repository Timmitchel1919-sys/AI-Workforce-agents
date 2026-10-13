/**
 * Firebase App Check verification abstraction.
 *
 * App Check answers "Is this request coming from an attested app?"
 * It is NOT authentication (that is Firebase Auth) and NOT
 * authorization (that is OperatorAccount + capabilities + project
 * scope). The modes are server-authoritative; client input must
 * never select the mode.
 */
export declare const APP_CHECK_MODES: readonly ["disabled", "monitor", "enforced"];
export type AppCheckMode = (typeof APP_CHECK_MODES)[number];
export interface AppAttestationResult {
    valid: boolean;
    appId?: string;
    error?: string;
}
export interface AppAttestationVerifier {
    verify(token: string | undefined): Promise<AppAttestationResult>;
}
/**
 * Default verifier used when no production verifier is wired. The
 * `monitor` and `disabled` modes make it a no-op; `enforced` treats
 * the verifier as UNAVAILABLE and the API fails closed on privileged
 * routes.
 */
export declare class DefaultAppAttestationVerifier implements AppAttestationVerifier {
    verify(_token: string | undefined): Promise<AppAttestationResult>;
}
/**
 * Observable App Check status attached to `SecureRequestContext`.
 * Never contains the token itself.
 */
export interface AppCheckStatus {
    mode: AppCheckMode;
    outcome: "not_required" | "valid" | "missing" | "invalid" | "unavailable";
    appId?: string;
    error?: string;
}
/**
 * Decide the App Check outcome for a request given the mode, token,
 * verifier and whether the route requires App Check. Pure function:
 * no side effects, no logging.
 */
export declare function evaluateAppCheck(input: {
    mode: AppCheckMode;
    token: string | undefined;
    verifier: AppAttestationVerifier | undefined;
    routeRequiresAppCheck: boolean;
}): Promise<AppCheckStatus>;
/**
 * Decide whether an App Check status should BLOCK the request.
 *
 * - `disabled`: never blocks.
 * - `monitor`: never blocks; the caller still records the event.
 * - `enforced`: blocks `missing`, `invalid`, `unavailable`.
 */
export declare function appCheckBlocks(status: AppCheckStatus): boolean;
/**
 * Resolve App Check mode from an environment variable, falling back
 * to `disabled`. The mode is server-authoritative — never read from
 * the request body or a client-controlled header.
 */
export declare function resolveAppCheckMode(env?: Record<string, string | undefined>): AppCheckMode;
/**
 * Header name the Firebase client SDK uses when it attaches an App
 * Check token. Extraction is centralized so no route handler reads
 * the header itself.
 */
export declare const APP_CHECK_HEADER = "x-firebase-appcheck";
/**
 * Health and status summary of App Check for diagnostics and Security Center.
 * Safe fields only; never carries tokens or secrets.
 */
export interface AppCheckSecurityStatus {
    mode: AppCheckMode;
    provider: string;
    configured: boolean;
    verifierHealthy: boolean;
    clientExpected: boolean;
    lastVerificationAt?: string;
    missingCount?: number;
    invalidCount?: number;
}
export interface AppCheckProductionConfigInput {
    mode: AppCheckMode;
    verifier?: AppAttestationVerifier;
    requiredPaths?: readonly RegExp[];
}
/**
 * Deterministically validates server App Check configuration at startup.
 * When mode is enforced, requires a real verifier and protected route patterns.
 */
export declare function validateAppCheckProductionConfig(input: AppCheckProductionConfigInput): {
    valid: boolean;
    error?: string;
};
