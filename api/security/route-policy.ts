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

export type RouteAuthenticationMode =
  "public" | "firebase_authenticated" | "active_operator";

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
export const DEFAULT_PRIVILEGED_APP_CHECK_ROUTES: readonly RegExp[] = [
  /^\/api\/commands\/.+/,
  /^\/api\/security\/.+/,
  /^\/api\/audit\/.+/,
  /^\/api\/grc\/.+/,
  /^\/api\/aigov\/.+/i,
  /^\/api\/datagov\/.+/i,
  /^\/api\/ops\/.+/,
  /^\/api\/itsm\/.+/,
  /^\/api\/portfolio\/.+/,
  /^\/api\/product\/.+/,
  /^\/api\/workforce\/.+/,
  /^\/api\/me\/profile(\/.*)?$/,
  /^\/api\/me\/access$/,
  /^\/api\/destructive\/.+/,
];

/**
 * Typed security policies for high-risk commands.
 * None of these commands can bypass Security Policy Engine evaluation, and
 * destructive actions must pass the DestructiveActionService gate.
 */
export const HIGH_RISK_COMMAND_POLICIES: Readonly<
  Record<string, RouteSecurityPolicy>
> = {
  // Destructive command: kill running execution session
  "kill-execution": {
    authentication: "active_operator",
    capability: "cancel_execution",
    projectScope: true,
    appCheck: "required",
    securityPolicyAction: "destroy.execution",
    risk: "high",
    destructive: true,
    rateLimitProfile: "destructive_request",
  },
  // Access and role mutations: identity security
  "revoke-access": {
    authentication: "active_operator",
    capability: "manage_access",
    projectScope: false,
    appCheck: "required",
    securityPolicyAction: "operator.access.revoke",
    risk: "high",
    destructive: true,
    rateLimitProfile: "access_management",
  },
  "suspend-access": {
    authentication: "active_operator",
    capability: "manage_access",
    projectScope: false,
    appCheck: "required",
    securityPolicyAction: "operator.access.suspend",
    risk: "high",
    destructive: false,
    rateLimitProfile: "access_management",
  },
  "reactivate-access": {
    authentication: "active_operator",
    capability: "manage_access",
    projectScope: false,
    appCheck: "required",
    securityPolicyAction: "operator.access.reactivate",
    risk: "high",
    destructive: false,
    rateLimitProfile: "access_management",
  },
  "change-operator-role": {
    authentication: "active_operator",
    capability: "manage_access",
    projectScope: false,
    appCheck: "required",
    securityPolicyAction: "operator.role.change",
    risk: "high",
    destructive: false,
    rateLimitProfile: "access_management",
  },
  "approve-access": {
    authentication: "active_operator",
    capability: "manage_access",
    projectScope: false,
    appCheck: "required",
    securityPolicyAction: "operator.access.approve",
    risk: "high",
    destructive: false,
    rateLimitProfile: "access_management",
  },
  "reject-access": {
    authentication: "active_operator",
    capability: "manage_access",
    projectScope: false,
    appCheck: "required",
    securityPolicyAction: "operator.access.reject",
    risk: "high",
    destructive: false,
    rateLimitProfile: "access_management",
  },
  // Agent enable / disable security paths
  "disable-agent": {
    authentication: "active_operator",
    capability: "disable_agent",
    projectScope: true,
    appCheck: "required",
    securityPolicyAction: "agent.security.disable",
    risk: "high",
    destructive: false,
    rateLimitProfile: "security_mutation",
  },
  "enable-agent": {
    authentication: "active_operator",
    capability: "enable_agent",
    projectScope: true,
    appCheck: "required",
    securityPolicyAction: "agent.security.enable",
    risk: "high",
    destructive: false,
    rateLimitProfile: "security_mutation",
  },
  // Policy mutations
  "set-budget-policy": {
    authentication: "active_operator",
    capability: "manage_budget_policy",
    projectScope: true,
    appCheck: "required",
    securityPolicyAction: "policy.budget.set",
    risk: "high",
    destructive: false,
    rateLimitProfile: "security_mutation",
  },
  "set-governance-policy": {
    authentication: "active_operator",
    capability: "manage_governance_policy",
    projectScope: true,
    appCheck: "required",
    securityPolicyAction: "policy.governance.set",
    risk: "high",
    destructive: false,
    rateLimitProfile: "security_mutation",
  },
  // Approvals
  approve: {
    authentication: "active_operator",
    capability: "approve",
    projectScope: false,
    appCheck: "required",
    securityPolicyAction: "approval.approve",
    risk: "high",
    destructive: false,
    rateLimitProfile: "destructive_approval",
  },
  reject: {
    authentication: "active_operator",
    capability: "reject",
    projectScope: false,
    appCheck: "required",
    securityPolicyAction: "approval.reject",
    risk: "high",
    destructive: false,
    rateLimitProfile: "destructive_approval",
  },
  // Cancellations
  "cancel-execution": {
    authentication: "active_operator",
    capability: "cancel_execution",
    projectScope: true,
    appCheck: "required",
    securityPolicyAction: "cancel.execution",
    risk: "medium",
    destructive: false,
    rateLimitProfile: "authenticated_default",
  },
  "cancel-workflow": {
    authentication: "active_operator",
    capability: "cancel_workflow",
    projectScope: true,
    appCheck: "required",
    securityPolicyAction: "cancel.workflow",
    risk: "medium",
    destructive: false,
    rateLimitProfile: "authenticated_default",
  },
  "cancel-task": {
    authentication: "active_operator",
    capability: "cancel_task",
    projectScope: true,
    appCheck: "required",
    securityPolicyAction: "cancel.task",
    risk: "medium",
    destructive: false,
    rateLimitProfile: "authenticated_default",
  },
};

/** Resolve static request metadata without reading a body or trusting input. */
export function routeSecurityPolicyFor(
  method: string,
  path: string,
  basePath = "/api",
): RouteSecurityPolicy | undefined {
  const escapedBase = basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalizedMethod = method.toUpperCase();
  if (
    (normalizedMethod === "POST" || normalizedMethod === "PATCH") &&
    new RegExp(`^${escapedBase}/security/secret-references(?:/[^/]+)?$`).test(
      path,
    )
  ) {
    return {
      authentication: "active_operator",
      capability: "manage_secret_references",
      appCheck: "required",
      risk: "high",
      securityPolicyAction:
        normalizedMethod === "POST"
          ? "secret.reference.create"
          : "secret.reference.update",
      destructive: true,
      requireJson: true,
      rateLimitProfile: "security_mutation",
    };
  }
  if (
    normalizedMethod === "PUT" &&
    new RegExp(`^${escapedBase}/security/foundation-policies/[^/]+$`).test(path)
  ) {
    return {
      authentication: "active_operator",
      capability: "manage_security_policy",
      appCheck: "required",
      risk: "critical",
      securityPolicyAction: "security_policy.mutate",
      destructive: true,
      requireJson: true,
      rateLimitProfile: "security_mutation",
    };
  }
  if (
    normalizedMethod === "POST" &&
    new RegExp(`^${escapedBase}/destructive/requests/[^/]+/decide$`).test(path)
  ) {
    return {
      authentication: "active_operator",
      capability: "approve_destructive_action",
      appCheck: "required",
      risk: "critical",
      rateLimitProfile: "destructive_approval",
    };
  }
  if (
    normalizedMethod === "POST" &&
    path === `${basePath}/destructive/requests`
  ) {
    return {
      authentication: "active_operator",
      capability: "request_destructive_action",
      appCheck: "required",
      risk: "high",
      rateLimitProfile: "destructive_request",
    };
  }
  if (normalizedMethod !== "POST") return undefined;
  const match = new RegExp(`^${escapedBase}/commands/([^/]+)$`).exec(path);
  if (!match) return undefined;
  return HIGH_RISK_COMMAND_POLICIES[match[1]!];
}
