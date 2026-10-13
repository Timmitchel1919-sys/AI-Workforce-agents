/**
 * Route Security Policy and Privileged Route definitions (Layer 5).
 *
 * Attaches typed security metadata to high-risk routes and commands:
 * - authentication mode
 * - required capability
 * - projectScope requirement
 * - appCheck requirement
 * - securityPolicyAction for SecurityPolicyEngine evaluation
 * - risk classification (low, medium, high, critical)
 * - destructive flag (requires DestructiveActionService gate)
 */
import type { ControlCapability } from "../../contracts/control.js";
import type { SecurityRiskLevel } from "../../contracts/security-policy.js";
export type RouteAuthenticationMode = "public" | "firebase_authenticated" | "active_operator";
export interface RouteSecurityPolicy {
    authentication: RouteAuthenticationMode;
    capability?: ControlCapability;
    projectScope?: boolean;
    appCheck?: "optional" | "required";
    risk?: SecurityRiskLevel;
    securityPolicyAction?: string;
    destructive?: boolean;
    requireJson?: boolean;
    maxBodyBytes?: number;
    rateLimitProfile?: string;
}
/**
 * Privileged application API route patterns that require App Check attestation
 * in production when App Check is in `enforced` mode.
 *
 * Notice:
 * - `/api/health` is explicitly EXCLUDED (public liveness probe).
 * - `/api/me/access` is explicitly INCLUDED for application-origin requests to
 *   prevent unverified clients from probing access states without device attestation.
 */
export declare const DEFAULT_PRIVILEGED_APP_CHECK_ROUTES: readonly RegExp[];
/**
 * Typed security policies for high-risk commands.
 * None of these commands can bypass Security Policy Engine evaluation, and
 * destructive actions must pass the DestructiveActionService gate.
 */
export declare const HIGH_RISK_COMMAND_POLICIES: Readonly<Record<string, RouteSecurityPolicy>>;
/** Resolve static request metadata without reading a body or trusting input. */
export declare function routeSecurityPolicyFor(method: string, path: string, basePath?: string): RouteSecurityPolicy | undefined;
