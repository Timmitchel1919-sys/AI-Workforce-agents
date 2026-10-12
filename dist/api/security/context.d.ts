import type { OperatorPrincipal } from "../../contracts/index.js";
import type { SecurityMfaEvidence, SecurityReauthenticationEvidence } from "../../contracts/destructive-action.js";
import type { AppCheckStatus } from "./app-check.js";
/**
 * Server-authoritative request context. Every field is constructed on
 * the trusted side of the request boundary — raw request body values
 * NEVER populate `operator`, `firebaseUid`, `mfa` or `reauth`. The
 * API hands this context to downstream services; services read from
 * it rather than parsing headers / tokens themselves.
 *
 * The context deliberately does NOT carry raw tokens, authorization
 * headers, cookies, or App Check tokens — those stay on the request
 * object and never surface in logs or audit events.
 */
export interface SecureRequestContext {
    requestId: string;
    correlationId: string;
    method: string;
    path: string;
    ip?: string;
    userAgent?: string;
    authenticated: boolean;
    firebaseUid?: string;
    operator?: OperatorPrincipal;
    projectId?: string;
    appCheck?: AppCheckStatus;
    reauthentication?: SecurityReauthenticationEvidence;
    mfa?: SecurityMfaEvidence;
}
