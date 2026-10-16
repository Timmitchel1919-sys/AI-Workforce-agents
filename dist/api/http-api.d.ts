import { type IncomingMessage, type ServerResponse } from "node:http";
import { type IdentityVerifier, type OperatorDirectory } from "../contracts/index.js";
import { type WorkforceCommandService, type WorkforceQueryService } from "../control/index.js";
import type { AccessService, ProfileService } from "../core/index.js";
import { FirebaseMfaVerifier, FirebaseReauthenticationVerifier, type AppAttestationVerifier, type AppCheckMode, type CorsPolicy, type RateLimiter } from "./security/index.js";
import { DestructiveActionService } from "../core/security/destructive-action-service.js";
import { SecurityPolicyEngine } from "../core/security/security-policy-engine.js";
import type { SecurityPolicyService } from "../core/security/security-policy-service.js";
import type { SecretReferenceService } from "../core/security/secret-reference-service.js";
import type { IncidentResponseService } from "../core/secops/incident-response-service.js";
import type { OperatorAccountStore } from "../contracts/index.js";
import { type AsyncSecurityEventStore } from "../contracts/security-event.js";
export interface ControlPlaneApiOptions {
    query: WorkforceQueryService;
    graphQuery?: import("../control/index.js").GraphQueryService;
    command: WorkforceCommandService;
    /** PROJECT-2: project onboarding & provisioning (admin-only, governed). */
    onboarding?: import("../control/index.js").OnboardingControlService;
    /** PROJECT-2: refreshes provisioned projects into the registry (self-throttled). */
    projectSync?: () => Promise<void>;
    operatorDirectory: OperatorDirectory;
    /**
     * AUTHZ-1: verifies a token WITHOUT requiring an active role, for
     * `GET /me/access` only. Every other route still needs `operatorDirectory`.
     */
    identityVerifier?: IdentityVerifier;
    /** AUTHZ-1: serves `GET /me/access` (the caller's own access state). */
    /** UI Layer 11 emergency lockdown. Absent => no lockdown routes, nothing blocked. */
    lockdown?: Pick<import("../core/access/lockdown-service.js").LockdownService, "status" | "activate" | "lift">;
    access?: Pick<AccessService, "myAccess"> & Partial<Pick<AccessService, "resolvePrincipal" | "revokeOwnSessions" | "isSessionRevoked">>;
    /** The caller's own profile (`/me/profile`, photo upload/removal). */
    profile?: Pick<ProfileService, "myProfile" | "setPhoto" | "removePhoto">;
    itsm?: import("../control/services/itsm-control-service.js").ITSMControlService;
    ops?: import("../control/services/operations-service.js").OperationsControlService;
    grc?: import("../control/services/grc-service.js").GrcControlService;
    aiGov?: import("../control/services/ai-governance-service.js").AIGovernanceControlService;
    dataGov?: import("../control/services/data-governance-service.js").DataGovernanceService;
    security?: import("../control/services/security-service.js").SecurityControlService;
    audit?: import("../control/services/audit-service.js").AuditControlService;
    portfolio?: import("../control/services/portfolio-service.js").PortfolioControlService;
    product?: import("../control/services/product-service.js").ProductManagementService;
    workforce?: import("../control/services/workforce-service.js").WorkforceManagementService;
    /** Path prefix for every route. Default `/api`. */
    basePath?: string;
    /** Request header carrying an inbound correlation id. Default `x-correlation-id`. */
    correlationHeader?: string;
    generateCorrelationId?: () => string;
    /** Max JSON request body size in bytes. Default 1 MiB. */
    maxBodyBytes?: number;
    destructiveActionService?: DestructiveActionService;
    securityPolicyService?: SecurityPolicyService;
    secretReferenceService?: SecretReferenceService;
    incidentResponseService?: IncidentResponseService;
    secretRotationService?: import("../core/security/secret-rotation-service.js").SecretRotationService;
    securityFindingStore?: import("../core/security/security-finding-source.js").SecurityFindingStore;
    deploymentSecurityGate?: import("../core/security/deployment-security-gate.js").DeploymentSecurityGate;
    securityPolicyEngine?: SecurityPolicyEngine;
    operatorAccounts?: OperatorAccountStore;
    securityEventStore?: AsyncSecurityEventStore | import("../core/security/security-event-store.js").SecurityEventStore;
    mfaVerifier?: FirebaseMfaVerifier;
    reauthVerifier?: FirebaseReauthenticationVerifier;
    /**
     * Layer-5 API Security options. All fields are optional so existing
     * tests and dev harnesses continue to work; production composition
     * supplies the real verifier + CORS policy + rate limiter.
     */
    apiSecurity?: {
        cors?: CorsPolicy;
        rateLimiter?: RateLimiter;
        appCheck?: {
            mode?: AppCheckMode;
            verifier?: AppAttestationVerifier;
            /** Route paths (within basePath) that require App Check in enforced mode. */
            requiredPaths?: readonly RegExp[];
        };
        /** Emit production HTTPS headers (HSTS). Opt-in. */
        production?: boolean;
    };
}
export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void;
export declare function createControlPlaneApi(options: ControlPlaneApiOptions): ApiHandler;
