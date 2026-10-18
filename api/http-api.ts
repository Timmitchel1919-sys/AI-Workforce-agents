/**
 * Control Plane HTTP API.
 *
 * A dependency-free Node `http` request handler that exposes
 * `WorkforceQueryService` (read) and `WorkforceCommandService` (write) over
 * JSON. This is the seam the Phase 7C UI consumes:
 *
 *   UI → HTTP API → Query / Command service → Core → Repository → Firebase
 *
 * The API is NOT the authority. It authenticates the caller (via the injected
 * `OperatorDirectory`), threads a correlation id, maps errors and command
 * `errorKind`s to status codes, and forwards everything else to the two
 * services — which enforce authorization, approval, state, project isolation,
 * and audit. No stack trace is ever sent to a client.
 */
import { randomUUID } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  type TaskRequirements,
  WorkforceError,
  type AuditEventQuery,
  type ControlErrorKind,
  type ExecutionJob,
  type IdentityVerifier,
  type OperatorDirectory,
  type OperatorPrincipal,
  operatorCan,
  operatorCanAccessProject,
  type TaskQuery,
  type VerifiedIdentity,
  type WorkflowQuery,
  type WorkforceGraphUnchanged,
} from "../contracts/index.js";
import type { ExecutionJobQueue } from "../core/execution/execution-job-queue.js";
import {
  type WorkforceCommandService,
  type WorkforceQueryService,
} from "../control/index.js";
import { sanitizeCorrelationId } from "../control/correlation.js";
import { parseGraphQueryParams } from "../control/services/graph-query-service.js";
import type { AccessService, ProfileService } from "../core/index.js";
import {
  APP_CHECK_HEADER,
  DEFAULT_CORS,
  applyCors,
  applySecurityHeaders,
  apiError,
  appCheckBlocks,
  createInMemoryRateLimiter,
  evaluateAppCheck,
  resolveAppCheckMode,
  routeSecurityPolicyFor,
  FirebaseMfaVerifier,
  FirebaseReauthenticationVerifier,
  createRequestScopedApproverResolver,
  stripUntrustedFields,
  DEFAULT_PRIVILEGED_APP_CHECK_ROUTES,
  type AppAttestationVerifier,
  type AppCheckMode,
  type CorsPolicy,
  type RateLimiter,
} from "./security/index.js";
import {
  DestructiveActionService,
  type DestructiveApproverResolver,
} from "../core/security/destructive-action-service.js";
import { SecurityPolicyEngine } from "../core/security/security-policy-engine.js";
import type { SecurityPolicyService } from "../core/security/security-policy-service.js";
import type { SecretReferenceService } from "../core/security/secret-reference-service.js";
import type { IncidentResponseService } from "../core/secops/incident-response-service.js";
import type { OperatorAccountStore } from "../contracts/index.js";
import {
  SECURITY_EVENT_TYPES,
  type AsyncSecurityEventStore,
} from "../contracts/security-event.js";
import { normalizeSecurityEvent } from "../core/security/security-event-normalizer.js";

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
  lockdown?: Pick<
    import("../core/access/lockdown-service.js").LockdownService,
    "status" | "activate" | "lift"
  >;
  access?: Pick<AccessService, "myAccess"> &
    Partial<
      Pick<
        AccessService,
        "resolvePrincipal" | "revokeOwnSessions" | "isSessionRevoked"
      >
    >;
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
  securityEventStore?:
    | AsyncSecurityEventStore
    | import("../core/security/security-event-store.js").SecurityEventStore;
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
  /**
   * R2 HTTP response boundary flush. If set, the `send()` helper awaits
   * this before writing the response head so write-through durable
   * repositories (assignments, leases, receipts) and any pending audit
   * events are durable in Firestore before the client sees success.
   */
  flushDurableWrites?: () => Promise<void>;
  /**
   * R2B — the Firestore-backed execution-job queue the Cloud Run worker
   * drains. Set together with `executionWorkerEnabled`; both must be set
   * for the admin `/execution-jobs` routes to accept work. Fail-closed
   * when unset.
   */
  executionJobQueue?: ExecutionJobQueue;
  /**
   * R2B — backend-authoritative execution worker activation. The
   * `EXECUTION_WORKER_ENABLED` env flag resolves to this; the UI cannot
   * set it. When false, the admin `/execution-jobs` routes return 503
   * and no production tool handlers run.
   */
  executionWorkerEnabled?: boolean;
}

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void;

const ONBOARDING_METHODS: Record<
  string,
  | "onboardingCreate"
  | "onboardingUpdate"
  | "onboardingAnalyze"
  | "onboardingPlan"
  | "onboardingApprovePlan"
  | "onboardingProvision"
  | "onboardingRevalidate"
  | "onboardingCancel"
> = {
  onboarding_create: "onboardingCreate",
  onboarding_update: "onboardingUpdate",
  onboarding_analyze: "onboardingAnalyze",
  onboarding_plan: "onboardingPlan",
  onboarding_approve_plan: "onboardingApprovePlan",
  onboarding_provision: "onboardingProvision",
  onboarding_revalidate: "onboardingRevalidate",
  onboarding_cancel: "onboardingCancel",
};

const ERROR_KIND_STATUS: Record<ControlErrorKind, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_state: 409,
  approval_failure: 422,
  command_failure: 500,
};

const COMMAND_METHODS: Record<
  string,
  keyof WorkforceCommandService | undefined
> = {
  approve: "approve",
  reject: "reject",
  "cancel-task": "cancelTask",
  "retry-task": "retryTask",
  "pause-workflow": "pauseWorkflow",
  "resume-workflow": "resumeWorkflow",
  "cancel-workflow": "cancelWorkflow",
  "disable-agent": "disableAgent",
  "enable-agent": "enableAgent",
  "create-execution-plan": "createExecutionPlan",
  "replan-execution-plan": "replanExecutionPlan",
  "submit-execution-plan": "submitExecutionPlan",
  "approve-access": "approveAccess",
  "reject-access": "rejectAccess",
  "suspend-access": "suspendAccess",
  "reactivate-access": "reactivateAccess",
  "revoke-access": "revokeAccess",
  "cancel-execution": "cancelExecution",
  "kill-execution": "killExecution",
  "change-operator-role": "changeOperatorRole",
  // EO-5.1 — Software Factory orchestration.
  "plan-from-objective": "planFromObjective",
  "create-program": "createProgram",
  "create-workstream": "createWorkstream",
  "add-workstream-task": "addTaskToWorkstream",
  "tick-software-factory": "tickSoftwareFactory",
  // UI Layer 4 — Workflow Studio (authoring; never executes).
  "save-workflow-draft": "saveWorkflowDraft",
  "validate-workflow": "validateWorkflow",
  "publish-workflow": "publishWorkflow",
  "archive-workflow": "archiveWorkflow",
  "restore-workflow-version": "restoreWorkflowVersion",
  "duplicate-workflow": "duplicateWorkflow",
  // UI Layer 13 - knowledge documents.
  "save-knowledge-document": "saveKnowledgeDocument",
  "archive-knowledge-document": "archiveKnowledgeDocument",
  // EO-6.2 / EO-6.3 — AI Cost Center & Governance Policy Engine.
  "set-budget-policy": "setBudgetPolicy",
  "set-governance-policy": "setGovernancePolicy",
  "evaluate-governance": "evaluateGovernance",
};

function defaultCorrelationId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `corr_${Date.now()}_${Math.random()}`;
}

function statusForError(error: unknown): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof PermissionDeniedError) return 403;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof StateTransitionError) return 409;
  if (error instanceof WorkforceError) return 409;
  return 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "internal error";
}

export function createControlPlaneApi(
  options: ControlPlaneApiOptions,
): ApiHandler {
  const base = (options.basePath ?? "/api").replace(/\/$/, "");
  const corrHeader = (
    options.correlationHeader ?? "x-correlation-id"
  ).toLowerCase();
  const newCorrelationId =
    options.generateCorrelationId ?? defaultCorrelationId;
  const maxBody = options.maxBodyBytes ?? 1_048_576;
  const { query, command, operatorDirectory } = options;

  // Layer-5 middleware primitives — instantiated once per API composition
  // so rate-limit buckets, App Check config and CORS policy stay stable
  // across the handler's lifetime and never leak between tests.
  const apiSecurity = options.apiSecurity;
  const corsPolicy = apiSecurity?.cors ?? DEFAULT_CORS;
  const rateLimiter = apiSecurity?.rateLimiter ?? createInMemoryRateLimiter();
  const appCheckMode: AppCheckMode =
    apiSecurity?.appCheck?.mode ?? resolveAppCheckMode();
  const appCheckVerifier = apiSecurity?.appCheck?.verifier;
  const appCheckRequiredPaths: readonly RegExp[] =
    apiSecurity?.appCheck?.requiredPaths ??
    (appCheckMode === "enforced" ? DEFAULT_PRIVILEGED_APP_CHECK_ROUTES : []);
  const productionHeaders = apiSecurity?.production === true;
  const mfaVerifier = options.mfaVerifier ?? new FirebaseMfaVerifier();
  const reauthVerifier =
    options.reauthVerifier ?? new FirebaseReauthenticationVerifier();
  const securityEventStore = options.securityEventStore;

  async function recordSecurityEvent(
    event: Omit<Parameters<typeof normalizeSecurityEvent>[0], "eventId"> & {
      eventId?: string;
    },
  ): Promise<void> {
    if (!securityEventStore) return;
    try {
      const normalized = normalizeSecurityEvent({
        ...event,
        eventId: event.eventId ?? `sec_${randomUUID()}`,
      });
      const res = securityEventStore.append(normalized);
      if (res && typeof (res as Promise<void>).then === "function") {
        await res;
      }
    } catch {
      // Security event logging must not crash unprivileged operations
    }
  }

  return (req, res) => {
    void handle(req, res).catch((error: unknown) => {
      send(res, 500, { error: { message: errorMessage(error) } }, "");
    });
  };

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // Centralized response-security headers for every API response.
    applySecurityHeaders(res, { production: productionHeaders });

    // CORS: short-circuit the preflight before any auth logic.
    const corsOutcome = applyCors(req, res, corsPolicy);
    if (corsOutcome === "preflight_ok" || corsOutcome === "preflight_denied")
      return;

    // The inbound id reaches audit records and the response header: only a well-formed one is kept.
    const correlationId =
      sanitizeCorrelationId(headerValue(req, corrHeader)) ?? newCorrelationId();
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/$/, "");
    const method = (req.method ?? "GET").toUpperCase();
    const routePolicy = routeSecurityPolicyFor(method, path, base);

    // Rate limit, keyed by route + remote ip (pre-auth signal). Health
    // probes are intentionally exempt — load balancers depend on them.
    if (!(method === "GET" && path === base + "/health")) {
      const ipHeader = headerValue(req, "x-forwarded-for")
        ?.split(",")[0]
        ?.trim();
      const rateKey = `${method}:${path}:${ipHeader ?? req.socket.remoteAddress ?? "unknown"}`;
      const decision = rateLimiter.check({
        profile: routePolicy?.rateLimitProfile ?? "authenticated_default",
        key: rateKey,
      });
      if (!decision.allowed) {
        await recordSecurityEvent({
          category: "api_security",
          type: SECURITY_EVENT_TYPES.RATE_LIMIT_EXCEEDED,
          severity: "medium",
          outcome: "blocked",
          actor: { kind: "unknown" },
          source: { kind: "network", ip: ipHeader },
          correlationId,
          evidence: {
            path,
            retryAfterSeconds: decision.retryAfterSeconds,
          },
        });
        if (decision.retryAfterSeconds !== undefined) {
          res.setHeader("retry-after", String(decision.retryAfterSeconds));
        }
        const { status, body } = apiError(
          "rate_limited",
          "too many requests",
          correlationId,
        );
        return send(res, status, body, correlationId);
      }
    }

    // App Check — pre-auth. In `disabled` mode this is a no-op; in
    // `monitor` it never blocks; in `enforced` it blocks protected
    // routes with missing/invalid/unavailable attestation.
    const token = headerValue(req, APP_CHECK_HEADER);
    const routeRequiresAppCheck =
      routePolicy?.appCheck === "required" ||
      appCheckRequiredPaths.some((re) => re.test(path));
    const appCheck = await evaluateAppCheck({
      mode: appCheckMode,
      token: token ?? undefined,
      verifier: appCheckVerifier,
      routeRequiresAppCheck,
    });
    if (appCheckBlocks(appCheck)) {
      const code =
        appCheck.outcome === "missing"
          ? "app_check_missing"
          : appCheck.outcome === "unavailable"
            ? "security_dependency_unavailable"
            : "app_check_invalid";
      await recordSecurityEvent({
        category: "api_security",
        type: code,
        severity: appCheck.outcome === "unavailable" ? "high" : "medium",
        outcome: "blocked",
        actor: { kind: "unknown" },
        source: {
          kind: "network",
          ip:
            headerValue(req, "x-forwarded-for")?.split(",")[0]?.trim() ||
            req.socket.remoteAddress,
        },
        correlationId,
        evidence: {
          path,
          appCheckOutcome: appCheck.outcome,
        },
      });
      const { status, body } = apiError(
        code,
        "App Check verification required",
        correlationId,
      );
      return send(res, status, body, correlationId);
    }

    if (!path.startsWith(base + "/") && path !== base) {
      return send(res, 404, { error: { message: "not found" } }, correlationId);
    }
    const route = path.slice(base.length) || "/";
    const segs = route.split("/").filter(Boolean);

    // Liveness — no auth.
    if (method === "GET" && segs.length === 1 && segs[0] === "health") {
      return send(res, 200, { status: "ok" }, correlationId);
    }

    // `GET /me/access` — the signed-in user's own access state. Needs only a
    // verified identity (authentication), never an active role: this is how
    // a pending user learns they are pending. Creates a PENDING request on
    // first contact; grants nothing.
    // UI Layer 11 emergency lockdown: GET status (any active operator),
    // POST activate / lift (administrator with a recent sign-in, audited).
    if (route === "/platform/lockdown" || route === "/platform/lockdown/lift") {
      const identity = await verifyIdentity(req);
      const access = options.access;
      const principal =
        identity && access?.resolvePrincipal
          ? await access.resolvePrincipal(identity)
          : null;
      if (!identity || !principal) {
        return send(
          res,
          401,
          { error: { message: "authentication required" } },
          correlationId,
        );
      }
      if (!options.lockdown) {
        return send(
          res,
          404,
          { error: { message: "not found" } },
          correlationId,
        );
      }
      try {
        if (method === "GET" && route === "/platform/lockdown") {
          return send(res, 200, await options.lockdown.status(), correlationId);
        }
        if (method !== "POST") {
          return send(
            res,
            405,
            { error: { message: "method not allowed" } },
            correlationId,
          );
        }
        const body =
          route === "/platform/lockdown" ? await readJsonBody(req, 4096) : {};
        const state =
          route === "/platform/lockdown"
            ? await options.lockdown.activate(
                principal,
                identity.authTime,
                body.reason,
                correlationId,
              )
            : await options.lockdown.lift(
                principal,
                identity.authTime,
                correlationId,
              );
        await recordSecurityEvent({
          category: "authorization",
          type: SECURITY_EVENT_TYPES.POLICY_CHANGED,
          severity: "high",
          outcome: "allowed",
          actor: { kind: "human", id: principal.id },
          source: { kind: "network", ip: req.socket.remoteAddress },
          correlationId,
          evidence: {
            lockdown: state.active ? "active" : "lifted",
            revision: state.revision,
          },
        });
        return send(res, 200, state, correlationId);
      } catch (error) {
        return send(
          res,
          statusForError(error),
          { error: { message: errorMessage(error) } },
          correlationId,
        );
      }
    }

    // UI Layer 7 lost-device response: `POST /me/sessions/revoke` signs the
    // caller out of EVERY device (including this one). Only an active operator
    // whose current token is still valid may do it; it only ever reduces access.
    if (method === "POST" && route === "/me/sessions/revoke") {
      const identity = await verifyIdentity(req);
      const access = options.access;
      const principal =
        identity && access?.resolvePrincipal
          ? await access.resolvePrincipal(identity)
          : null;
      if (!identity || !principal || !access?.revokeOwnSessions) {
        return send(
          res,
          401,
          { error: { message: "authentication required" } },
          correlationId,
        );
      }
      try {
        const result = await access.revokeOwnSessions(identity, correlationId);
        await recordSecurityEvent({
          category: "authentication",
          type: SECURITY_EVENT_TYPES.SESSION_REVOKED,
          severity: "medium",
          outcome: "allowed",
          actor: { kind: "human", id: principal.id },
          source: {
            kind: "network",
            ip:
              headerValue(req, "x-forwarded-for")?.split(",")[0]?.trim() ||
              req.socket.remoteAddress,
          },
          correlationId,
          evidence: {
            scope: "all_devices",
            refreshTokensRevoked: result.refreshTokensRevoked,
          },
        });
        return send(res, 200, result, correlationId);
      } catch (error) {
        return send(
          res,
          statusForError(error),
          { error: { message: errorMessage(error) } },
          correlationId,
        );
      }
    }

    if (method === "GET" && route === "/me/access") {
      const identity = await verifyIdentity(req);
      if (!identity) {
        await recordSecurityEvent({
          category: "authentication",
          type: SECURITY_EVENT_TYPES.AUTH_FAILED,
          severity: "medium",
          outcome: "denied",
          actor: { kind: "unknown" },
          source: {
            kind: "network",
            ip:
              headerValue(req, "x-forwarded-for")?.split(",")[0]?.trim() ||
              req.socket.remoteAddress,
          },
          correlationId,
          evidence: { path: route },
        });
        return send(
          res,
          401,
          { error: { message: "authentication required" } },
          correlationId,
        );
      }
      if (!options.access) {
        return send(
          res,
          404,
          { error: { message: "not found" } },
          correlationId,
        );
      }
      try {
        if (await options.access.isSessionRevoked?.(identity)) {
          return send(
            res,
            401,
            {
              error: { message: "this session was signed out; sign in again" },
            },
            correlationId,
          );
        }
        return send(
          res,
          200,
          await options.access.myAccess(identity),
          correlationId,
        );
      } catch (error) {
        return send(
          res,
          statusForError(error),
          { error: { message: errorMessage(error) } },
          correlationId,
        );
      }
    }

    // Authenticate every other route.
    const principal = await authenticate(req);
    if (!principal) {
      await recordSecurityEvent({
        category: "authentication",
        type: SECURITY_EVENT_TYPES.AUTH_FAILED,
        severity: "medium",
        outcome: "denied",
        actor: { kind: "unknown" },
        source: {
          kind: "network",
          ip:
            headerValue(req, "x-forwarded-for")?.split(",")[0]?.trim() ||
            req.socket.remoteAddress,
        },
        correlationId,
        evidence: { path: route },
      });
      return send(
        res,
        401,
        { error: { message: "authentication required" } },
        correlationId,
      );
    }

    // R7 (ADR-0034) — per-operator post-auth rate limit on every non-GET
    // route. Sits on top of the earlier route+IP bucket: a compromised token
    // can rotate IPs, so the identity check is the one that bounds abuse per
    // principal. Health probes and read traffic are already excluded by
    // method.
    if (method !== "GET" && method !== "HEAD") {
      const opDecision = rateLimiter.check({
        profile: "operator_mutation",
        key: `operator:${principal.id}`,
      });
      if (!opDecision.allowed) {
        await recordSecurityEvent({
          category: "api_security",
          type: SECURITY_EVENT_TYPES.RATE_LIMIT_EXCEEDED,
          severity: "medium",
          outcome: "blocked",
          actor: { kind: "human", id: principal.id },
          source: {
            kind: "network",
            ip:
              headerValue(req, "x-forwarded-for")?.split(",")[0]?.trim() ||
              req.socket.remoteAddress,
          },
          correlationId,
          evidence: {
            path: route,
            method,
            scope: "operator_mutation",
            retryAfterSeconds: opDecision.retryAfterSeconds,
          },
        });
        if (opDecision.retryAfterSeconds !== undefined) {
          res.setHeader("retry-after", String(opDecision.retryAfterSeconds));
        }
        const { status, body } = apiError(
          "rate_limited",
          "too many requests for this operator",
          correlationId,
        );
        return send(res, status, body, correlationId);
      }
    }

    // Static route metadata is defense in depth. Core command services still
    // perform their own authorization; this early gate prevents privileged
    // handlers from being reached with a capability the route forbids.
    if (
      routePolicy?.capability &&
      !operatorCan(principal, routePolicy.capability)
    ) {
      await recordSecurityEvent({
        category: "authorization",
        type: SECURITY_EVENT_TYPES.CAPABILITY_DENIED,
        severity: "high",
        outcome: "denied",
        actor: { kind: "human", id: principal.id },
        source: {
          kind: "network",
          ip:
            headerValue(req, "x-forwarded-for")?.split(",")[0]?.trim() ||
            req.socket.remoteAddress,
        },
        correlationId,
        evidence: { path: route, capability: routePolicy.capability },
      });
      const { status, body } = apiError(
        "forbidden",
        "required capability is not granted",
        correlationId,
      );
      return send(res, status, body, correlationId);
    }

    try {
      if (options.projectSync) await options.projectSync();
      if (route.startsWith("/itsm/")) {
        return await handleItsm(
          route,
          segs,
          method,
          req,
          res,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/ops/")) {
        return await handleOperations(
          route,
          segs,
          method,
          req,
          res,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/grc/")) {
        return await handleGrc(
          route,
          segs,
          method,
          req,
          res,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/aigov/")) {
        return await handleAIGovernance(
          route,
          segs,
          method,
          req,
          res,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/datagov/")) {
        return await handleDataGovernance(
          route,
          segs,
          method,
          req,
          res,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/security/foundation-policies")) {
        return await handleFoundationPolicies(
          req,
          res,
          segs,
          method,
          principal,
          correlationId,
        );
      }
      if (
        route.startsWith("/security/secret-references") ||
        route.startsWith("/security/secrets")
      ) {
        return await handleSecretReferences(
          req,
          res,
          segs,
          method,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/security/findings")) {
        return await handleSecurityFindings(
          req,
          res,
          segs,
          method,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/security/incidents")) {
        return await handleSecurityIncidents(
          req,
          res,
          segs,
          method,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/security/deployment-gate")) {
        return await handleDeploymentGate(
          req,
          res,
          method,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/security/")) {
        return await handleSecurity(
          route,
          segs,
          method,
          req,
          res,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/audit/")) {
        return await handleAudit(
          route,
          segs,
          method,
          req,
          res,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/portfolio/")) {
        return await handlePortfolio(
          route,
          segs,
          method,
          req,
          res,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/product/")) {
        return await handleProduct(
          route,
          segs,
          method,
          req,
          res,
          principal,
          correlationId,
        );
      }
      // Specialist workforce routes are handled by the core workforce
      // query/plan handlers below. Keep the newer organization/workforce
      // management routes on their dedicated service without letting them
      // intercept specialist assignment, handoff, and planning requests.
      const isSpecialistWorkforceRoute =
        route === "/workforce/plan" ||
        route === "/workforce/assignments" ||
        route.startsWith("/workforce/assignments/") ||
        route === "/workforce/handoffs";
      if (route.startsWith("/workforce/") && !isSpecialistWorkforceRoute) {
        return await handleWorkforce(
          route,
          segs,
          method,
          req,
          res,
          principal,
          correlationId,
        );
      }
      if (route === "/me/profile" || route === "/me/profile/photo") {
        return await handleProfile(
          req,
          res,
          route,
          method,
          principal,
          correlationId,
        );
      }
      // R2B — admin-only execution-job routes. Fail-closed when the
      // backend flag is off or the queue is unset. The worker is the
      // only consumer; this endpoint never executes code itself.
      if (segs[0] === "execution-jobs") {
        return await handleExecutionJobs(
          req,
          res,
          segs,
          method,
          principal,
          correlationId,
        );
      }
      if (method === "GET") {
        return await handleGet(
          res,
          segs,
          url.searchParams,
          principal,
          correlationId,
        );
      }
      if (method === "POST" && route === "/execution/preflight") {
        // EO-4.1: evaluation only. There is no execute / shell endpoint.
        let body: Record<string, unknown>;
        try {
          body = await readJsonBody(req, maxBody);
        } catch (error) {
          return send(
            res,
            400,
            { error: { message: errorMessage(error) } },
            correlationId,
          );
        }
        return send(
          res,
          200,
          notNull(await query.executionPreflight(principal, body)),
          correlationId,
        );
      }
      // `POST /workforce/plan` — the honest staffing answer for a project.
      // Always a DRY RUN: this endpoint plans and reports, it never binds an
      // agent to work. Creating an assignment is a host-side decision, not a
      // side effect of a read.
      if (method === "POST" && route === "/workforce/plan") {
        let body: Record<string, unknown>;
        try {
          body = await readJsonBody(req, maxBody);
        } catch (error) {
          return send(
            res,
            400,
            { error: { message: errorMessage(error) } },
            correlationId,
          );
        }
        const projectId =
          typeof body.projectId === "string" ? body.projectId : "";
        if (!projectId) {
          return send(
            res,
            400,
            { error: { message: "projectId is required" } },
            correlationId,
          );
        }
        // A malformed `tasks` field must be REJECTED, not treated as "no tasks".
        // Defaulting it to `[]` answered "fully staffed" for a request that never
        // described any work, which is a staffing claim the caller did not ask
        // for and the server cannot support.
        if (!Array.isArray(body.tasks)) {
          return send(
            res,
            400,
            { error: { message: "tasks must be an array" } },
            correlationId,
          );
        }
        const rawTasks = body.tasks;
        let tasks: { taskId: string; requirements: TaskRequirements }[];
        try {
          tasks = rawTasks.map((entry, index) => {
            if (
              typeof entry !== "object" ||
              entry === null ||
              Array.isArray(entry)
            ) {
              throw new ValidationError(`tasks[${index}] must be an object`);
            }
            const record = entry as Record<string, unknown>;
            if (typeof record.taskId !== "string" || !record.taskId) {
              throw new ValidationError(`tasks[${index}].taskId is required`);
            }
            if (
              typeof record.requirements !== "object" ||
              record.requirements === null ||
              Array.isArray(record.requirements)
            ) {
              throw new ValidationError(
                `tasks[${index}].requirements is required`,
              );
            }
            return {
              taskId: record.taskId,
              requirements: record.requirements as TaskRequirements,
            };
          });
        } catch (error) {
          return send(
            res,
            400,
            { error: { message: errorMessage(error) } },
            correlationId,
          );
        }
        const workload = await query.getProjectWorkforce(
          principal,
          projectId,
          tasks,
        );
        if (!workload) {
          return send(
            res,
            404,
            {
              error: {
                message:
                  "specialist workforce is not composed, or the project is not accessible",
              },
            },
            correlationId,
          );
        }
        return send(res, 200, workload, correlationId);
      }
      if (method === "POST" && segs[0] === "commands" && segs.length === 2) {
        return await handleCommand(
          req,
          res,
          segs[1]!,
          principal,
          correlationId,
        );
      }
      if (route.startsWith("/destructive/")) {
        return await handleDestructive(
          req,
          res,
          route,
          segs,
          method,
          principal,
          correlationId,
        );
      }
      return send(
        res,
        method === "POST" ? 404 : 405,
        { error: { message: "not found" } },
        correlationId,
      );
    } catch (error) {
      return send(
        res,
        statusForError(error),
        { error: { message: errorMessage(error) } },
        correlationId,
      );
    }
  }

  async function verifyIdentity(
    req: IncomingMessage,
  ): Promise<VerifiedIdentity | null> {
    const verifier =
      options.identityVerifier ??
      ("verify" in options.operatorDirectory
        ? (options.operatorDirectory as unknown as IdentityVerifier)
        : undefined);
    if (!verifier) return null;
    const header = headerValue(req, "authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return null;
    return verifier.verify(match[1]!.trim());
  }

  async function authenticate(
    req: IncomingMessage,
  ): Promise<OperatorPrincipal | null> {
    const header = headerValue(req, "authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return null;
    return operatorDirectory.resolve(match[1]!.trim());
  }

  async function handleDestructive(
    req: IncomingMessage,
    res: ServerResponse,
    route: string,
    segs: string[],
    method: string,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    const service = options.destructiveActionService;
    if (!service) {
      return send(
        res,
        404,
        { error: { message: "destructive action service not configured" } },
        correlationId,
      );
    }

    if (
      method !== "GET" &&
      options.lockdown &&
      (await options.lockdown.status()).active
    ) {
      return send(
        res,
        423,
        {
          error: {
            message:
              "emergency lockdown is active; destructive actions are suspended",
          },
        },
        correlationId,
      );
    }
    try {
      // POST /destructive/requests
      if (route === "/destructive/requests" && method === "POST") {
        const rawBody = await readJsonBody(req, maxBody);
        const body = stripUntrustedFields(rawBody);
        const result = service.request(
          principal,
          body as unknown as import("../contracts/destructive-action.js").DestructiveActionRequestDraft,
          correlationId,
        );
        return send(res, 201, result, correlationId);
      }

      // GET /destructive/requests
      if (route === "/destructive/requests" && method === "GET") {
        const requests = service.list();
        return send(res, 200, { requests }, correlationId);
      }

      // GET /destructive/requests/:id
      if (
        segs.length === 3 &&
        segs[0] === "destructive" &&
        segs[1] === "requests" &&
        method === "GET"
      ) {
        const item = service.get(segs[2]!);
        if (!item) {
          return send(
            res,
            404,
            { error: { message: "not found" } },
            correlationId,
          );
        }
        return send(res, 200, item, correlationId);
      }

      // POST /destructive/requests/:id/decide
      if (
        segs.length === 4 &&
        segs[0] === "destructive" &&
        segs[1] === "requests" &&
        segs[3] === "decide" &&
        method === "POST"
      ) {
        const rawBody = await readJsonBody(req, maxBody);
        const body = stripUntrustedFields(rawBody);
        const result = service.decide(
          principal,
          segs[2]!,
          body.decision as import("../contracts/destructive-action.js").DestructiveApprovalDecision,
          typeof body.reason === "string" ? body.reason : undefined,
        );
        return send(res, 200, result, correlationId);
      }

      // POST /destructive/requests/:id/execute
      if (
        segs.length === 4 &&
        segs[0] === "destructive" &&
        segs[1] === "requests" &&
        segs[3] === "execute" &&
        method === "POST"
      ) {
        return send(
          res,
          405,
          {
            error: {
              message:
                "generic destructive execution is disabled; use the bound resource executor",
            },
          },
          correlationId,
        );
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  async function handleFoundationPolicies(
    req: IncomingMessage,
    res: ServerResponse,
    segs: string[],
    method: string,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    const service = options.securityPolicyService;
    if (!service) {
      return send(res, 404, { error: { message: "not found" } }, correlationId);
    }
    if (method === "GET" && segs.length === 2) {
      return send(
        res,
        200,
        { policies: service.list(principal) },
        correlationId,
      );
    }
    if (method !== "PUT" || segs.length !== 3) {
      return send(
        res,
        405,
        { error: { message: "method not allowed" } },
        correlationId,
      );
    }

    const rawBody = await readJsonBody(req, maxBody);
    const body = stripUntrustedFields(rawBody);
    const policy = body.policy;
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      throw new ValidationError("policy object is required");
    }
    if ((policy as { id?: unknown }).id !== segs[2]) {
      throw new ValidationError("policy id must match the route id");
    }
    if (typeof body.destructiveActionId !== "string") {
      throw new ValidationError("destructiveActionId is required");
    }

    const identity = await verifyIdentity(req);
    const destructive = options.destructiveActionService;
    if (!destructive) {
      throw new PermissionDeniedError("destructive action service unavailable");
    }
    const approverResolver = options.operatorAccounts
      ? await createRequestScopedApproverResolver(
          options.operatorAccounts,
          destructive.currentApproverIds(body.destructiveActionId),
        )
      : undefined;
    const stored = await service.upsert(
      principal,
      policy as import("../contracts/security-policy.js").SecurityPolicy,
      {
        correlationId,
        destructiveActionId: body.destructiveActionId,
        environment: productionHeaders ? "production" : "local",
        evidence: {
          mfa: mfaVerifier.verify(identity),
          reauth: reauthVerifier.verify(identity),
        },
        approverResolver,
      },
    );
    return send(res, 200, stored, correlationId);
  }

  async function handleSecretReferences(
    req: IncomingMessage,
    res: ServerResponse,
    segs: string[],
    method: string,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    const service = options.secretReferenceService;
    const destructive = options.destructiveActionService;
    if (!service || !destructive) {
      return send(res, 404, { error: { message: "not found" } }, correlationId);
    }
    if (method === "GET" && segs.length === 2) {
      return send(
        res,
        200,
        { references: service.list(principal) },
        correlationId,
      );
    }
    const isCreate = method === "POST" && segs.length === 2;
    const isUpdate = method === "PATCH" && segs.length === 3;
    const isRotate =
      method === "POST" && segs.length === 4 && segs[3] === "rotate";
    const isRevoke =
      method === "POST" && segs.length === 4 && segs[3] === "revoke";

    if (isRotate) {
      const rotationService = options.secretRotationService;
      if (!rotationService) {
        return send(
          res,
          404,
          { error: { message: "secret rotation service not configured" } },
          correlationId,
        );
      }
      const refId = segs[2]!;
      const list = service.list(principal);
      const target = list.find(
        (r) => r.id === refId || r.ref === `secret://${refId}`,
      );
      if (!target)
        throw new NotFoundError(`secret reference not found: ${refId}`);
      const body = await readJsonBody(req, maxBody);
      if (typeof body.newSecretValue !== "string" || !body.newSecretValue) {
        throw new ValidationError("newSecretValue is required for rotation");
      }
      const rotated = await rotationService.rotate(
        principal,
        target,
        body.newSecretValue,
        {
          principalType: "human",
          principalId: principal.id,
          projectId: target.projectId,
          environment: productionHeaders ? "production" : "local",
          purpose: `Manual rotation by ${principal.id}`,
          correlationId,
          requestedAt: new Date().toISOString(),
        },
      );
      return send(res, 200, rotated, correlationId);
    }

    if (isRevoke) {
      const rotationService = options.secretRotationService;
      if (!rotationService) {
        return send(
          res,
          404,
          { error: { message: "secret rotation service not configured" } },
          correlationId,
        );
      }
      const refId = segs[2]!;
      const list = service.list(principal);
      const target = list.find(
        (r) => r.id === refId || r.ref === `secret://${refId}`,
      );
      if (!target)
        throw new NotFoundError(`secret reference not found: ${refId}`);
      const revoked = await rotationService.emergencyRevoke(principal, target, {
        principalType: "human",
        principalId: principal.id,
        projectId: target.projectId,
        environment: productionHeaders ? "production" : "local",
        purpose: `Emergency revocation by ${principal.id}`,
        correlationId,
        requestedAt: new Date().toISOString(),
      });
      return send(res, 200, revoked, correlationId);
    }

    if (!isCreate && !isUpdate) {
      return send(
        res,
        405,
        { error: { message: "method not allowed" } },
        correlationId,
      );
    }
    const body = await readJsonBody(req, maxBody);
    if (typeof body.destructiveActionId !== "string") {
      throw new ValidationError("destructiveActionId is required");
    }
    const mutation = isCreate ? body.reference : body.update;
    if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) {
      throw new ValidationError(
        isCreate ? "reference object is required" : "update object is required",
      );
    }
    const identity = await verifyIdentity(req);
    const approverResolver = options.operatorAccounts
      ? await createRequestScopedApproverResolver(
          options.operatorAccounts,
          destructive.currentApproverIds(body.destructiveActionId),
        )
      : undefined;
    const context = {
      correlationId,
      destructiveActionId: body.destructiveActionId,
      environment: productionHeaders
        ? ("production" as const)
        : ("local" as const),
      evidence: {
        mfa: mfaVerifier.verify(identity),
        reauth: reauthVerifier.verify(identity),
      },
      approverResolver,
    };
    const stored = isCreate
      ? await service.create(
          principal,
          mutation as import("../contracts/secret-reference.js").ManagedSecretReferenceDraft,
          context,
        )
      : await service.update(
          principal,
          `secret://${segs[2]!}`,
          mutation as import("../contracts/secret-reference.js").ManagedSecretReferenceUpdate,
          context,
        );
    return send(res, isCreate ? 201 : 200, stored, correlationId);
  }

  async function handleSecurityIncidents(
    req: IncomingMessage,
    res: ServerResponse,
    segs: string[],
    method: string,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    const service = options.incidentResponseService;
    if (!service)
      return send(res, 404, { error: { message: "not found" } }, correlationId);
    const organizationId = req.headers["x-organization-id"];
    if (typeof organizationId !== "string" || !organizationId.trim()) {
      throw new ValidationError("x-organization-id is required");
    }
    if (method === "GET" && segs.length === 2) {
      return send(
        res,
        200,
        { incidents: service.listIncidents(principal, organizationId) },
        correlationId,
      );
    }
    const incidentId = segs[2];
    if (!incidentId)
      return send(
        res,
        405,
        { error: { message: "method not allowed" } },
        correlationId,
      );
    const isRequest =
      method === "POST" &&
      segs.length === 4 &&
      segs[3] === "containment-requests";
    const isExecute =
      method === "POST" && segs.length === 4 && segs[3] === "contain";
    if (isRequest) {
      const body = stripUntrustedFields(await readJsonBody(req, maxBody));
      const requested = service.requestContainment(principal, {
        incidentId,
        organizationId,
        targetResourceType:
          typeof body.targetResourceType === "string"
            ? body.targetResourceType
            : "incident",
        targetResourceId:
          typeof body.targetResourceId === "string"
            ? body.targetResourceId
            : incidentId,
        environment: productionHeaders ? "production" : "local",
        projectId:
          typeof body.projectId === "string" ? body.projectId : undefined,
        reason: typeof body.reason === "string" ? body.reason : "",
        correlationId,
      });
      return send(res, 201, requested, correlationId);
    }
    if (isExecute) {
      const body = stripUntrustedFields(await readJsonBody(req, maxBody));
      if (typeof body.destructiveActionId !== "string")
        throw new ValidationError("destructiveActionId is required");
      const identity = await verifyIdentity(req);
      const result = await service.executeContainment(
        principal,
        body.destructiveActionId,
        incidentId,
        organizationId,
        {
          mfa: mfaVerifier.verify(identity),
          reauth: reauthVerifier.verify(identity),
        },
      );
      return send(res, 200, result, correlationId);
    }
    if (method === "PATCH" && segs.length === 3) {
      const body = stripUntrustedFields(await readJsonBody(req, maxBody));
      if (
        typeof body.status !== "string" ||
        !["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED"].includes(
          body.status,
        )
      ) {
        throw new ValidationError("valid incident status is required");
      }
      return send(
        res,
        200,
        service.updateStatus(
          principal,
          incidentId,
          organizationId,
          body.status as import("../contracts/secops.js").SecurityIncident["status"],
        ),
        correlationId,
      );
    }
    return send(
      res,
      405,
      { error: { message: "method not allowed" } },
      correlationId,
    );
  }

  async function handleSecurityFindings(
    req: IncomingMessage,
    res: ServerResponse,
    _segs: string[],
    method: string,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    const store = options.securityFindingStore;
    if (!store) {
      return send(
        res,
        404,
        { error: { message: "security finding store not configured" } },
        correlationId,
      );
    }
    if (
      !operatorCan(principal, "view_security") &&
      !operatorCan(principal, "manage_security_policy")
    ) {
      throw new PermissionDeniedError("view_security capability required");
    }
    if (method === "GET") {
      return send(res, 200, { findings: store.list() }, correlationId);
    }
    if (method === "POST") {
      if (!operatorCan(principal, "manage_security_policy")) {
        throw new PermissionDeniedError(
          "manage_security_policy capability required",
        );
      }
      const body = await readJsonBody(req, maxBody);
      store.ingest(
        body as unknown as import("../contracts/security-finding.js").SecurityFinding,
      );
      return send(
        res,
        201,
        { finding: body, status: "ingested" },
        correlationId,
      );
    }
    return send(
      res,
      405,
      { error: { message: "method not allowed" } },
      correlationId,
    );
  }

  async function handleDeploymentGate(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    const gate = options.deploymentSecurityGate;
    if (!gate) {
      return send(
        res,
        404,
        { error: { message: "deployment security gate not configured" } },
        correlationId,
      );
    }
    if (
      !operatorCan(principal, "view_security") &&
      !operatorCan(principal, "manage_security_policy")
    ) {
      throw new PermissionDeniedError("view_security capability required");
    }
    if (method !== "POST") {
      return send(
        res,
        405,
        { error: { message: "method not allowed" } },
        correlationId,
      );
    }
    const body = await readJsonBody(req, maxBody);
    const env = (
      typeof body.environment === "string"
        ? body.environment
        : productionHeaders
          ? "production"
          : "staging"
    ) as "local" | "test" | "staging" | "production";
    const projectId =
      typeof body.projectId === "string" ? body.projectId : undefined;
    const override =
      body.override && typeof body.override === "object"
        ? ({
            ...(body.override as Record<string, unknown>),
            principal,
          } as unknown as import("../core/security/deployment-security-gate.js").SecurityOverrideRequest)
        : undefined;
    const evaluation = gate.evaluateDeployment(env, projectId, override);
    return send(res, 200, evaluation, correlationId);
  }

  async function handleGet(
    res: ServerResponse,
    segs: string[],
    params: URLSearchParams,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    const [head, id] = segs;
    switch (head) {
      case "onboarding": {
        const onboarding = options.onboarding;
        if (!onboarding) throw new NotFoundError("resource not found");
        if (id === "capabilities" && segs.length === 2) {
          return send(
            res,
            200,
            onboarding.capabilities(principal),
            correlationId,
          );
        }
        if (!id) {
          return send(
            res,
            200,
            { sessions: await onboarding.list(principal) },
            correlationId,
          );
        }
        if (segs.length === 2) {
          return send(
            res,
            200,
            await onboarding.get(principal, id),
            correlationId,
          );
        }
        throw new NotFoundError("resource not found");
      }
      case "status":
        return send(
          res,
          200,
          query.getWorkforceStatus(principal),
          correlationId,
        );
      case "system-health":
        return send(res, 200, query.getSystemHealth(principal), correlationId);
      case "dashboard":
        return send(
          res,
          200,
          await query.getDashboardSnapshot(principal),
          correlationId,
        );
      case "agents":
        return send(
          res,
          200,
          id
            ? notNull(query.getAgent(principal, id))
            : query.getAgents(principal),
          correlationId,
        );
      // ---- Specialist workforce (authoritative reads) ----
      case "workforce": {
        // `/api/workforce/assignments` — every assignment the operator may see.
        if (segs.length === 2 && segs[1] === "assignments") {
          const assignments = query.getAssignments(principal, {
            projectId: params.get("projectId") ?? undefined,
            taskId: params.get("taskId") ?? undefined,
            agentId: params.get("agentId") ?? undefined,
          });
          if (!assignments) {
            return send(
              res,
              404,
              { error: { message: "specialist workforce is not composed" } },
              correlationId,
            );
          }
          return send(res, 200, assignments, correlationId);
        }
        // `/api/workforce/assignments/:taskId/history` — every attempt,
        // including the ones that failed.
        //
        // The path splits into FOUR segments ("workforce", "assignments",
        // ":taskId", "history"); the task id is one segment on its own, so a
        // `segs[2].endsWith("/history")` test could never match and this route
        // silently 404d for every task. The id is therefore taken as its own
        // segment, which also rejects ids containing a slash instead of
        // guessing where the boundary was.
        if (
          segs.length === 4 &&
          segs[1] === "assignments" &&
          segs[3] === "history"
        ) {
          const taskId = segs[2]!;
          const history = query.getAssignmentHistory(principal, taskId);
          if (!history) {
            return send(
              res,
              404,
              {
                error: {
                  message:
                    "specialist workforce is not composed, or the task is not accessible",
                },
              },
              correlationId,
            );
          }
          return send(res, 200, history, correlationId);
        }
        // `/api/workforce/handoffs` — transfers and their destination evidence.
        if (segs.length === 2 && segs[1] === "handoffs") {
          const handoffs = query.getSpecialistHandoffs(principal, {
            taskId: params.get("taskId") ?? undefined,
          });
          if (!handoffs) {
            return send(
              res,
              404,
              { error: { message: "specialist workforce is not composed" } },
              correlationId,
            );
          }
          return send(res, 200, handoffs, correlationId);
        }
        return send(
          res,
          404,
          { error: { message: "not found" } },
          correlationId,
        );
      }
      case "tasks":
        return send(
          res,
          200,
          id
            ? notNull(query.getTask(principal, id))
            : query.getTasks(principal, parseTaskQuery(params)),
          correlationId,
        );
      case "workflows":
        return send(
          res,
          200,
          id
            ? notNull(query.getWorkflow(principal, id))
            : query.getWorkflows(principal, parseWorkflowQuery(params)),
          correlationId,
        );
      case "approvals":
        return send(
          res,
          200,
          query.getApprovalPage(principal, {
            ...statusFilter(params),
            ...parsePageQuery(params),
            ...(params.get("projectId")
              ? { projectId: params.get("projectId") as string }
              : {}),
          }),
          correlationId,
        );
      case "projects":
        if (segs.length === 3 && segs[2] === "graph" && options.graphQuery) {
          // Validate `since` before any work so a malformed value costs nothing.
          const since = params.get("since");
          if (since !== null && since !== "" && !/^\d{1,12}$/.test(since)) {
            throw new ValidationError("since must be a revision number");
          }
          const graph = notNull(
            await options.graphQuery.getWorkforceGraph(
              principal,
              parseGraphQueryParams(id!, params),
            ),
          );
          // Conditional poll: authorisation and projection above ran in full,
          // so `since` can only ever save bandwidth, never widen access.
          if (
            since !== null &&
            since !== "" &&
            Number(since) === graph.revision
          ) {
            const unchanged: WorkforceGraphUnchanged = {
              projectId: graph.projectId,
              mode: graph.mode,
              revision: graph.revision,
              generatedAt: graph.generatedAt,
              unchanged: true,
            };
            return send(res, 200, unchanged, correlationId);
          }
          return send(res, 200, graph, correlationId);
        }
        // EO-5.8 spatial intelligence: read-only, authorised exactly like the graph.
        if (segs.length === 3 && segs[2] === "insights" && options.graphQuery) {
          return send(
            res,
            200,
            notNull(await options.graphQuery.getInsights(principal, id!)),
            correlationId,
          );
        }
        // `GET /projects/:projectId/agents` — nested project resource route.
        if (segs.length === 3 && segs[2] === "agents") {
          return send(
            res,
            200,
            notNull(await query.getProjectAgents(principal, id!)),
            correlationId,
          );
        }
        // EO-4.7 Execution Control Center (project-scoped, bounded).
        if (segs[2] === "executions" && segs.length === 3) {
          return send(
            res,
            200,
            notNull(
              await query.getExecutionSessionPage(principal, id!, {
                ...(params.get("status")
                  ? { status: params.get("status")! }
                  : {}),
                ...boundedInts(params, ["limit", "offset"]),
              }),
            ),
            correlationId,
          );
        }
        if (segs[2] === "executions" && segs.length === 4) {
          const bounds = boundedInts(params, [
            "timelineLimit",
            "timelineOffset",
          ]);
          return send(
            res,
            200,
            notNull(
              await query.getExecutionSessionDetail(
                principal,
                id!,
                segs[3]!,
                bounds,
              ),
            ),
            correlationId,
          );
        }
        if (segs.length === 3 && segs[2] === "execution-overview") {
          return send(
            res,
            200,
            notNull(await query.getExecutionOverview(principal, id!)),
            correlationId,
          );
        }
        if (segs.length === 3 && segs[2] === "verifications") {
          return send(
            res,
            200,
            notNull(await query.getProjectVerifications(principal, id!)),
            correlationId,
          );
        }
        if (segs.length === 3 && segs[2] === "releases") {
          return send(
            res,
            200,
            notNull(await query.getProjectReleases(principal, id!)),
            correlationId,
          );
        }
        // EO-6.2 AI Cost Center: usage, budget policy, evaluated status.
        if (segs.length === 3 && segs[2] === "cost") {
          return send(
            res,
            200,
            notNull(await query.getProjectCostReport(principal, id!)),
            correlationId,
          );
        }
        // EO-6.2 rule-based Auditor findings (never model-assisted).
        if (segs.length === 3 && segs[2] === "audit-findings") {
          return send(
            res,
            200,
            notNull(await query.getProjectAuditFindings(principal, id!)),
            correlationId,
          );
        }
        // UI Layer 13 knowledge: list, one document (+versions), keyword search.
        if (segs.length === 3 && segs[2] === "knowledge") {
          return send(
            res,
            200,
            notNull(await query.getKnowledgeDocuments(principal, id!)),
            correlationId,
          );
        }
        if (segs.length === 3 && segs[2] === "knowledge-search") {
          return send(
            res,
            200,
            notNull(
              await query.searchKnowledge(principal, id!, params.get("q")),
            ),
            correlationId,
          );
        }
        if (segs.length === 4 && segs[2] === "knowledge") {
          return send(
            res,
            200,
            notNull(await query.getKnowledgeDocument(principal, id!, segs[3]!)),
            correlationId,
          );
        }
        // UI Layer 4 Workflow Studio: catalog, definitions, versions, simulation.
        if (
          segs.length === 4 &&
          segs[2] === "workflow-studio" &&
          segs[3] === "catalog"
        ) {
          return send(
            res,
            200,
            notNull(query.getWorkflowStudioCatalog(principal, id!)),
            correlationId,
          );
        }
        if (segs.length === 3 && segs[2] === "workflow-definitions") {
          return send(
            res,
            200,
            notNull(await query.getWorkflowDefinitions(principal, id!)),
            correlationId,
          );
        }
        if (segs.length === 4 && segs[2] === "workflow-definitions") {
          return send(
            res,
            200,
            notNull(
              await query.getWorkflowDefinition(principal, id!, segs[3]!),
            ),
            correlationId,
          );
        }
        if (
          segs.length === 5 &&
          segs[2] === "workflow-definitions" &&
          segs[4] === "simulation"
        ) {
          return send(
            res,
            200,
            notNull(
              await query.getWorkflowSimulation(
                principal,
                id!,
                segs[3]!,
                params.get("source"),
              ),
            ),
            correlationId,
          );
        }
        // EO-6.3 governance policy (provider/model allow-list, approval threshold).
        if (segs.length === 3 && segs[2] === "governance-policy") {
          return send(
            res,
            200,
            notNull(await query.getProjectGovernancePolicy(principal, id!)),
            correlationId,
          );
        }
        // EO-7 routing decision history / one reconstructable decision.
        if (segs.length === 3 && segs[2] === "routing-decisions") {
          return send(
            res,
            200,
            notNull(await query.getProjectRoutingDecisions(principal, id!)),
            correlationId,
          );
        }
        if (segs.length === 4 && segs[2] === "routing-decisions") {
          return send(
            res,
            200,
            notNull(
              await query.getProjectRoutingDecision(principal, id!, segs[3]!),
            ),
            correlationId,
          );
        }
        // `GET /projects/:projectId/execution-sessions` (EO-4.1, metadata only)
        if (segs.length === 3 && segs[2] === "execution-sessions") {
          return send(
            res,
            200,
            notNull(await query.getExecutionSessions(principal, id!)),
            correlationId,
          );
        }
        // `GET /projects/:projectId/execution-plans[/:planId][?version=N]`
        // — planning state only; there is no execution route.
        if (segs[2] === "execution-plans" && segs.length === 3) {
          return send(
            res,
            200,
            notNull(
              await query.getExecutionPlans(
                principal,
                id!,
                parsePageQuery(params),
              ),
            ),
            correlationId,
          );
        }
        // `current` is reserved: plan ids are `plan_<uuid>`.
        if (
          segs[2] === "execution-plans" &&
          segs.length === 4 &&
          segs[3] === "current"
        ) {
          const current = await query.getCurrentExecutionPlan(principal, id!);
          // undefined → 404 (unknown/foreign project); null → no plan yet.
          if (current === undefined)
            throw new NotFoundError("resource not found");
          return send(res, 200, { plan: current }, correlationId);
        }
        if (segs[2] === "execution-plans" && segs.length === 4) {
          return send(
            res,
            200,
            notNull(
              await query.getExecutionPlan(
                principal,
                id!,
                segs[3]!,
                parsePlanVersion(params),
              ),
            ),
            correlationId,
          );
        }
        if (segs.length >= 3) {
          return send(
            res,
            404,
            { error: { message: "not found" } },
            correlationId,
          );
        }
        return send(
          res,
          200,
          id
            ? notNull(await query.getProject(principal, id))
            : await query.getProjects(principal),
          correlationId,
        );
      case "tools":
        return send(
          res,
          200,
          id
            ? notNull(query.getTool(principal, id))
            : query.getTools(principal),
          correlationId,
        );
      case "environments":
        // GET /api/environments/descriptors[/:id], GET /api/environments/instances[/:id]
        if (segs[1] === "descriptors") {
          return send(
            res,
            200,
            segs.length >= 3
              ? notNull(query.getEnvironmentDescriptor(principal, segs[2]!))
              : query.getEnvironmentDescriptors(principal),
            correlationId,
          );
        }
        if (segs[1] === "instances") {
          return send(
            res,
            200,
            segs.length >= 3
              ? notNull(query.getEnvironmentInstance(principal, segs[2]!))
              : query.getEnvironmentInstances(principal),
            correlationId,
          );
        }
        return send(
          res,
          404,
          { error: { message: "not found" } },
          correlationId,
        );
      case "hosts":
        // GET /api/hosts[/:id], GET /api/hosts/:id/capabilities
        if (segs.length === 3 && segs[2] === "capabilities") {
          return send(
            res,
            200,
            notNull(query.getHostCapabilitySnapshot(principal, id!)),
            correlationId,
          );
        }
        return send(
          res,
          200,
          id
            ? notNull(query.getHost(principal, id))
            : query.getHosts(principal),
          correlationId,
        );
      case "execution":
        // GET /api/execution/operations, GET /api/execution/sessions/:sessionId
        if (segs.length === 2 && segs[1] === "environments") {
          return send(
            res,
            200,
            query.getExecutionEnvironments(principal),
            correlationId,
          );
        }
        if (segs.length === 2 && segs[1] === "operations") {
          return send(
            res,
            200,
            query.getExecutionOperations(principal),
            correlationId,
          );
        }
        if (segs.length === 3 && segs[1] === "sessions") {
          return send(
            res,
            200,
            notNull(await query.getExecutionSession(principal, segs[2]!)),
            correlationId,
          );
        }
        return send(
          res,
          404,
          { error: { message: "not found" } },
          correlationId,
        );
      case "integrations":
        // UI Layer 14: GET /api/integrations/registry
        if (segs.length === 2 && segs[1] === "registry") {
          return send(
            res,
            200,
            query.getIntegrationRegistry(principal),
            correlationId,
          );
        }
        return send(
          res,
          404,
          { error: { message: "not found" } },
          correlationId,
        );
      case "intelligence":
        // UI Layer 6: GET /api/intelligence/models — declared model profiles.
        if (segs.length === 2 && segs[1] === "models") {
          return send(
            res,
            200,
            query.getModelRegistry(principal),
            correlationId,
          );
        }
        return send(
          res,
          404,
          { error: { message: "not found" } },
          correlationId,
        );
      case "planning":
        // GET /api/planning/technologies — read-only planner catalog.
        if (segs.length === 2 && segs[1] === "technologies") {
          return send(
            res,
            200,
            query.getTechnologyCatalog(principal),
            correlationId,
          );
        }
        return send(
          res,
          404,
          { error: { message: "not found" } },
          correlationId,
        );
      case "operators":
        // GET /api/operators — Users & Access (administrators only).
        if (segs.length !== 1) {
          return send(
            res,
            404,
            { error: { message: "not found" } },
            correlationId,
          );
        }
        return send(
          res,
          200,
          notNull(await query.getOperatorAccounts(principal)),
          correlationId,
        );
      case "audit":
        return send(
          res,
          200,
          query.getAuditEvents(principal, parseAuditQuery(params)),
          correlationId,
        );
      case "software-factory":
        // UI Layer 5: GET /api/software-factory/pipeline — truthful stage modes.
        if (segs.length === 2 && segs[1] === "pipeline") {
          return send(
            res,
            200,
            query.getFactoryPipeline(principal),
            correlationId,
          );
        }
        // GET /api/software-factory, GET /api/software-factory/programs/:programId
        if (segs[1] === "programs" && segs.length === 3) {
          const projectId = params.get("projectId");
          if (!projectId || projectId.trim() === "") {
            return send(
              res,
              400,
              { error: { message: "projectId is required" } },
              correlationId,
            );
          }
          return send(
            res,
            200,
            query.getSoftwareFactoryProgramDetail(
              principal,
              projectId,
              segs[2]!,
            ),
            correlationId,
          );
        }
        if (segs.length === 1) {
          const projectId = params.get("projectId");
          if (projectId !== null && projectId.trim() === "") {
            return send(
              res,
              400,
              { error: { message: "projectId must not be blank" } },
              correlationId,
            );
          }
          return send(
            res,
            200,
            query.getSoftwareFactoryOverview(principal, projectId ?? undefined),
            correlationId,
          );
        }
        return send(
          res,
          404,
          { error: { message: "not found" } },
          correlationId,
        );
      default:
        return send(
          res,
          404,
          { error: { message: "not found" } },
          correlationId,
        );
    }
  }

  async function handleItsm(
    route: string,
    segs: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (!options.itsm)
      return send(
        res,
        404,
        { error: { message: "itsm not found" } },
        correlationId,
      );

    try {
      if (segs[1] === "services") {
        if (method === "GET") {
          return send(
            res,
            200,
            await options.itsm.listServices(principal.id),
            correlationId,
          );
        } else if (method === "POST") {
          const body = await readJsonBody(req, maxBody);
          return send(
            res,
            200,
            await options.itsm.createService(
              body as Parameters<typeof options.itsm.createService>[0],
            ),
            correlationId,
          );
        }
      }

      if (segs[1] === "incidents") {
        if (method === "GET") {
          const serviceId = new URL(
            req.url ?? "/",
            "http://localhost",
          ).searchParams.get("serviceId");
          return send(
            res,
            200,
            await options.itsm.listIncidents(
              principal.id,
              serviceId || undefined,
            ),
            correlationId,
          );
        } else if (method === "POST") {
          const body = await readJsonBody(req, maxBody);
          return send(
            res,
            200,
            await options.itsm.createIncident(
              body as Parameters<typeof options.itsm.createIncident>[0],
            ),
            correlationId,
          );
        }
      }

      if (segs[1] === "changes") {
        if (method === "GET") {
          return send(
            res,
            200,
            await options.itsm.listChangeRequests(principal.id),
            correlationId,
          );
        } else if (method === "POST") {
          const body = await readJsonBody(req, maxBody);
          return send(
            res,
            200,
            await options.itsm.createChangeRequest(
              body as Parameters<typeof options.itsm.createChangeRequest>[0],
            ),
            correlationId,
          );
        }
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  async function handleOperations(
    route: string,
    segs: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (!options.ops)
      return send(
        res,
        404,
        { error: { message: "ops not available" } },
        correlationId,
      );

    try {
      if (segs[1] === "health") {
        if (method === "GET") {
          return send(
            res,
            200,
            await options.ops.getGlobalHealth(),
            correlationId,
          );
        } else if (method === "POST") {
          const body = await readJsonBody(req, maxBody);
          return send(
            res,
            200,
            await options.ops.reportHealth(
              principal,
              body as Parameters<typeof options.ops.reportHealth>[1],
            ),
            correlationId,
          );
        }
      }

      if (segs[1] === "alerts") {
        if (method === "GET") {
          return send(res, 200, await options.ops.listAlerts(), correlationId);
        }
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  async function handleGrc(
    route: string,
    segs: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (!options.grc)
      return send(
        res,
        404,
        { error: { message: "grc not available" } },
        correlationId,
      );

    try {
      if (segs[1] === "frameworks" && method === "GET") {
        return send(
          res,
          200,
          await options.grc.listFrameworks(),
          correlationId,
        );
      }
      if (segs[1] === "risks" && method === "GET") {
        return send(
          res,
          200,
          await options.grc.listRisks("global"),
          correlationId,
        );
      }
      if (segs[1] === "trust-content" && method === "GET") {
        return send(
          res,
          200,
          await options.grc.listTrustCenterContent(),
          correlationId,
        );
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  async function handleAIGovernance(
    route: string,
    segs: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (!options.aiGov)
      return send(
        res,
        404,
        { error: { message: "ai governance not available" } },
        correlationId,
      );

    try {
      if (segs[1] === "models" && method === "GET") {
        return send(res, 200, await options.aiGov.listModels(), correlationId);
      }
      if (segs[1] === "use-cases" && method === "GET") {
        // Simple global fetch for prototype
        return send(
          res,
          200,
          await options.aiGov.listUseCases("global"),
          correlationId,
        );
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  async function handleDataGovernance(
    route: string,
    segs: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (!options.dataGov)
      return send(
        res,
        404,
        { error: { message: "data governance not available" } },
        correlationId,
      );

    try {
      if (segs[1] === "assets" && method === "GET") {
        return send(
          res,
          200,
          await options.dataGov.listAssets(),
          correlationId,
        );
      }
      if (segs[1] === "retention-policies" && method === "GET") {
        return send(
          res,
          200,
          await options.dataGov.listRetentionPolicies(),
          correlationId,
        );
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  async function handleSecurity(
    route: string,
    segs: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (!options.security)
      return send(
        res,
        404,
        { error: { message: "security not available" } },
        correlationId,
      );

    try {
      if (segs[1] === "events" && method === "GET") {
        return send(
          res,
          200,
          await options.security.listEvents(principal),
          correlationId,
        );
      }
      if (segs[1] === "canonical-events" && method === "GET") {
        const params = new URL(req.url ?? "/", "http://localhost").searchParams;
        return send(
          res,
          200,
          await options.security.listCanonicalEvents(principal, {
            projectId: params.get("projectId") ?? undefined,
            limit: Number(params.get("limit") ?? 100),
          }),
          correlationId,
        );
      }
      if (segs[1] === "policies" && method === "GET") {
        return send(
          res,
          200,
          await options.security.listPolicies(principal),
          correlationId,
        );
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  async function handleAudit(
    route: string,
    segs: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (!options.audit)
      return send(
        res,
        404,
        { error: { message: "audit not available" } },
        correlationId,
      );

    try {
      if (segs[1] === "logs" && method === "GET") {
        return send(
          res,
          200,
          await options.audit.listAuditLogs(),
          correlationId,
        );
      }
      if (segs[1] === "findings" && method === "GET") {
        return send(
          res,
          200,
          await options.audit.listFindings(),
          correlationId,
        );
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  async function handlePortfolio(
    route: string,
    segs: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (!options.portfolio)
      return send(
        res,
        404,
        { error: { message: "portfolio not available" } },
        correlationId,
      );

    try {
      if (segs[1] === "portfolios" && method === "GET") {
        return send(
          res,
          200,
          await options.portfolio.listPortfolios(),
          correlationId,
        );
      }
      if (segs[1] === "programs" && method === "GET") {
        return send(
          res,
          200,
          await options.portfolio.listPrograms(),
          correlationId,
        );
      }
      if (segs[1] === "objectives" && method === "GET") {
        return send(
          res,
          200,
          await options.portfolio.listObjectives(),
          correlationId,
        );
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  async function handleProduct(
    route: string,
    segs: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (!options.product)
      return send(
        res,
        404,
        { error: { message: "product not available" } },
        correlationId,
      );

    try {
      if (segs[1] === "products" && method === "GET") {
        return send(
          res,
          200,
          await options.product.listProducts(),
          correlationId,
        );
      }
      if (segs[1] === "problems" && method === "GET") {
        return send(
          res,
          200,
          await options.product.listProblems(),
          correlationId,
        );
      }
      if (segs[1] === "features" && method === "GET") {
        return send(
          res,
          200,
          await options.product.listFeatures(),
          correlationId,
        );
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  async function handleWorkforce(
    route: string,
    segs: string[],
    method: string,
    req: IncomingMessage,
    res: ServerResponse,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (!options.workforce)
      return send(
        res,
        404,
        { error: { message: "workforce not available" } },
        correlationId,
      );

    try {
      if (segs[1] === "departments" && method === "GET") {
        return send(
          res,
          200,
          await options.workforce.listDepartments(),
          correlationId,
        );
      }
      if (segs[1] === "teams" && method === "GET") {
        return send(
          res,
          200,
          await options.workforce.listTeams(),
          correlationId,
        );
      }
      if (segs[1] === "agents" && method === "GET") {
        return send(
          res,
          200,
          await options.workforce.listAgents(),
          correlationId,
        );
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(
        res,
        statusForError(e),
        { error: { message: errorMessage(e) } },
        correlationId,
      );
    }
  }

  /**
   * `GET /me/profile`, `PUT /me/profile/photo` {dataUrl},
   * `DELETE /me/profile/photo` — always the principal's own profile.
   */
  async function handleExecutionJobs(
    req: IncomingMessage,
    res: ServerResponse,
    segs: readonly string[],
    method: string,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    // R2B — fail-closed when the backend flag is off or the queue was
    // not supplied by the composition root. Returned as 503 so a client
    // can distinguish "disabled" from "forbidden" or "not found".
    if (!options.executionWorkerEnabled || !options.executionJobQueue) {
      return send(
        res,
        503,
        { error: { message: "execution worker disabled" } },
        correlationId,
      );
    }
    if (principal.role !== "admin") {
      return send(
        res,
        403,
        { error: { message: "admin role required" } },
        correlationId,
      );
    }
    const queue = options.executionJobQueue;

    // POST /execution-jobs  — enqueue a new job
    if (method === "POST" && segs.length === 1) {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req, maxBody);
      } catch (error) {
        return send(
          res,
          400,
          { error: { message: errorMessage(error) } },
          correlationId,
        );
      }
      const projectId = typeof body.projectId === "string" ? body.projectId : "";
      if (!projectId) {
        return send(
          res,
          400,
          { error: { message: "projectId required" } },
          correlationId,
        );
      }
      if (!operatorCanAccessProject(principal, projectId)) {
        return send(
          res,
          403,
          { error: { message: "project outside operator scope" } },
          correlationId,
        );
      }
      const tool = body.tool as
        | { toolId?: unknown; action?: unknown; input?: unknown; requiredCapability?: unknown }
        | undefined;
      if (
        !tool ||
        typeof tool.toolId !== "string" ||
        typeof tool.action !== "string" ||
        typeof tool.requiredCapability !== "string"
      ) {
        return send(
          res,
          400,
          { error: { message: "tool.toolId, tool.action and tool.requiredCapability required" } },
          correlationId,
        );
      }
      const idempotencyKey =
        typeof body.idempotencyKey === "string" && body.idempotencyKey
          ? body.idempotencyKey
          : `job-${randomUUID()}`;
      // Dedupe: same idempotency key returns the existing job.
      const existing = await queue.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        return send(
          res,
          200,
          { jobId: existing.jobId, status: existing.status, deduped: true },
          correlationId,
        );
      }
      const now = new Date().toISOString();
      const job: ExecutionJob = {
        jobId: `job_${randomUUID()}`,
        idempotencyKey,
        projectId,
        taskId: typeof body.taskId === "string" ? body.taskId : "ad-hoc",
        agentId:
          typeof body.agentId === "string" ? body.agentId : `operator:${principal.id}`,
        executionId:
          typeof body.executionId === "string" ? body.executionId : `exec_${randomUUID()}`,
        tool: {
          toolId: tool.toolId,
          action: tool.action,
          input: tool.input ?? {},
          requiredCapability: tool.requiredCapability,
        },
        status: "queued",
        attempt: 0,
        maxAttempts:
          typeof body.maxAttempts === "number" && body.maxAttempts >= 1
            ? Math.min(10, Math.floor(body.maxAttempts))
            : 3,
        createdAt: now,
        availableAt: now,
        updatedAt: now,
      };
      try {
        await queue.enqueue({ job });
      } catch (error) {
        return send(
          res,
          400,
          { error: { message: errorMessage(error) } },
          correlationId,
        );
      }
      return send(res, 202, { jobId: job.jobId, status: job.status }, correlationId);
    }

    // GET /execution-jobs/{jobId} — read status
    if (method === "GET" && segs.length === 2) {
      const jobId = segs[1];
      const job = await queue.get(jobId);
      if (!job) {
        return send(res, 404, { error: { message: "job not found" } }, correlationId);
      }
      if (!operatorCanAccessProject(principal, job.projectId)) {
        return send(
          res,
          403,
          { error: { message: "project outside operator scope" } },
          correlationId,
        );
      }
      return send(res, 200, { job }, correlationId);
    }

    // POST /execution-jobs/{jobId}/cancel — cancellation request
    if (method === "POST" && segs.length === 3 && segs[2] === "cancel") {
      const jobId = segs[1];
      const job = await queue.get(jobId);
      if (!job) {
        return send(res, 404, { error: { message: "job not found" } }, correlationId);
      }
      if (!operatorCanAccessProject(principal, job.projectId)) {
        return send(
          res,
          403,
          { error: { message: "project outside operator scope" } },
          correlationId,
        );
      }
      let reason = "operator-requested";
      try {
        const body = await readJsonBody(req, maxBody);
        if (typeof body.reason === "string" && body.reason) reason = body.reason;
      } catch {
        /* body optional */
      }
      await queue.requestCancellation(jobId, reason);
      return send(res, 202, { jobId, cancellationRequested: true }, correlationId);
    }

    return send(res, 405, { error: { message: "method not allowed" } }, correlationId);
  }

  async function handleProfile(
    req: IncomingMessage,
    res: ServerResponse,
    route: string,
    method: string,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    const profile = options.profile;
    if (!profile) {
      return send(res, 404, { error: { message: "not found" } }, correlationId);
    }
    if (route === "/me/profile" && method === "GET") {
      return send(res, 200, await profile.myProfile(principal), correlationId);
    }
    if (route === "/me/profile/photo" && method === "PUT") {
      const body = await readJsonBody(req, maxBody);
      return send(
        res,
        200,
        await profile.setPhoto(principal, body.dataUrl, correlationId),
        correlationId,
      );
    }
    if (route === "/me/profile/photo" && method === "DELETE") {
      return send(
        res,
        200,
        await profile.removePhoto(principal, correlationId),
        correlationId,
      );
    }
    return send(
      res,
      405,
      { error: { message: "method not allowed" } },
      correlationId,
    );
  }

  async function handleCommand(
    req: IncomingMessage,
    res: ServerResponse,
    name: string,
    principal: OperatorPrincipal,
    correlationId: string,
  ): Promise<void> {
    if (name.startsWith("onboarding_") && options.onboarding) {
      const onboarding = options.onboarding;
      const method = Object.hasOwn(ONBOARDING_METHODS, name)
        ? ONBOARDING_METHODS[name]
        : undefined;
      if (!method) {
        return send(
          res,
          404,
          { error: { message: `unknown command: ${name}` } },
          correlationId,
        );
      }
      let payload: Record<string, unknown>;
      try {
        payload = await readJsonBody(req, maxBody);
      } catch (error) {
        return send(
          res,
          400,
          { error: { message: errorMessage(error) } },
          correlationId,
        );
      }
      const fn = onboarding[method] as (
        p: OperatorPrincipal,
        input: Record<string, unknown>,
        opts: { correlationId: string },
      ) => Promise<{ errorKind?: ControlErrorKind }>;
      const outcome = await fn.call(onboarding, principal, payload, {
        correlationId,
      });
      return send(
        res,
        outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200,
        outcome,
        correlationId,
      );
    }
    // Own properties only: inherited names ("constructor", "__proto__", "toString") are not commands.
    // UI Layer 11: an active emergency lockdown refuses every command.
    if (options.lockdown && (await options.lockdown.status()).active) {
      return send(
        res,
        423,
        {
          error: {
            message: "emergency lockdown is active; commands are suspended",
          },
        },
        correlationId,
      );
    }
    const methodName = Object.hasOwn(COMMAND_METHODS, name)
      ? COMMAND_METHODS[name]
      : undefined;
    if (!methodName) {
      return send(
        res,
        404,
        { error: { message: `unknown command: ${name}` } },
        correlationId,
      );
    }
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req, maxBody);
    } catch (error) {
      return send(
        res,
        400,
        { error: { message: errorMessage(error) } },
        correlationId,
      );
    }

    const routePolicy = routeSecurityPolicyFor(
      "POST",
      `${base}/commands/${name}`,
      base,
    );
    let destructiveExecutionId: string | undefined;
    if (routePolicy) {
      if (routePolicy.projectScope && typeof body.projectId === "string") {
        if (!operatorCanAccessProject(principal, body.projectId)) {
          await recordSecurityEvent({
            category: "authorization",
            type: SECURITY_EVENT_TYPES.PROJECT_SCOPE_DENIED,
            severity: "high",
            outcome: "denied",
            actor: { kind: "human", id: principal.id },
            source: {
              kind: "network",
              ip:
                headerValue(req, "x-forwarded-for")?.split(",")[0]?.trim() ||
                req.socket.remoteAddress,
            },
            correlationId,
            evidence: { command: name, projectId: body.projectId },
          });
          const { status, body: errBody } = apiError(
            "forbidden",
            `operator does not have access to project ${body.projectId}`,
            correlationId,
          );
          return send(res, status, errBody, correlationId);
        }
      }

      if (options.securityPolicyEngine && routePolicy.securityPolicyAction) {
        const decision = options.securityPolicyEngine.evaluate({
          action: routePolicy.securityPolicyAction,
          actorId: principal.id,
          actorType: "human",
          role: principal.role,
          projectId:
            typeof body.projectId === "string" ? body.projectId : undefined,
          environment:
            apiSecurity?.production === true ? "production" : "local",
          targetResourceType: "control_plane_command",
          targetResourceId: name,
          destructive: routePolicy.destructive === true,
          irreversible: body.irreversible === true,
          production: apiSecurity?.production === true,
          requestedAt: new Date().toISOString(),
          correlationId,
        });
        if (!decision.allowed) {
          await recordSecurityEvent({
            category: "policy",
            type: SECURITY_EVENT_TYPES.POLICY_DENIED,
            severity: decision.risk === "critical" ? "critical" : "high",
            outcome: "denied",
            actor: { kind: "human", id: principal.id },
            source: {
              kind: "network",
              ip:
                headerValue(req, "x-forwarded-for")?.split(",")[0]?.trim() ||
                req.socket.remoteAddress,
            },
            correlationId,
            evidence: { command: name, reason: decision.reason },
          });
          const { status, body: errBody } = apiError(
            "forbidden",
            decision.reason ?? "security policy denied action",
            correlationId,
          );
          return send(res, status, errBody, correlationId);
        }
      }

      if (
        routePolicy.destructive &&
        (options.destructiveActionService || productionHeaders)
      ) {
        if (
          !options.destructiveActionService ||
          typeof body.destructiveActionId !== "string"
        ) {
          return send(
            res,
            403,
            { error: { message: "approved destructiveActionId is required" } },
            correlationId,
          );
        }
        const verifiedIdentity = await verifyIdentity(req);
        const mfa = mfaVerifier.verify(verifiedIdentity);
        const reauth = reauthVerifier.verify(verifiedIdentity);
        const record = options.destructiveActionService.get(
          String(body.destructiveActionId),
        );
        if (!record) {
          return send(
            res,
            404,
            { error: { message: "destructive action request not found" } },
            correlationId,
          );
        }
        let approverResolver: DestructiveApproverResolver | undefined;
        if (options.operatorAccounts) {
          approverResolver = await createRequestScopedApproverResolver(
            options.operatorAccounts,
            options.destructiveActionService.currentApproverIds(record.id),
          );
        }

        try {
          options.destructiveActionService.assertApproved({
            requestId: body.destructiveActionId,
            principal,
            actionType: record.actionType,
            targetResourceType: "control_plane_command",
            targetResourceId: name,
            environment: productionHeaders ? "production" : "local",
            projectId:
              typeof body.projectId === "string"
                ? body.projectId
                : record.projectId,
            evidence: { mfa, reauth },
            approverResolver,
          });
          destructiveExecutionId = body.destructiveActionId;
        } catch (e) {
          return send(
            res,
            statusForError(e),
            { error: { message: errorMessage(e) } },
            correlationId,
          );
        }
      }
    }

    const fn = command[methodName] as (
      p: OperatorPrincipal,
      input: unknown,
      opts: { correlationId: string },
    ) => Promise<{ errorKind?: ControlErrorKind }>;
    let result: { errorKind?: ControlErrorKind };
    try {
      result = await fn.call(command, principal, body, { correlationId });
    } catch (error) {
      if (destructiveExecutionId && options.destructiveActionService) {
        options.destructiveActionService.markFailed(
          destructiveExecutionId,
          principal.id,
          errorMessage(error),
        );
      }
      throw error;
    }
    if (destructiveExecutionId && options.destructiveActionService) {
      if (result.errorKind) {
        options.destructiveActionService.markFailed(
          destructiveExecutionId,
          principal.id,
          `command failed: ${result.errorKind}`,
        );
      } else {
        options.destructiveActionService.markExecuted(
          destructiveExecutionId,
          principal.id,
          Object.freeze({ command: name, correlationId }),
        );
      }
    }
    const status = result.errorKind ? ERROR_KIND_STATUS[result.errorKind] : 200;
    return send(res, status, result, correlationId);
  }

  async function send(
    res: ServerResponse,
    status: number,
    payload: unknown,
    correlationId: string,
  ): Promise<void> {
    // R2 — HTTP response boundary flush. Awaits any pending durable
    // writes (R1 write-through caches, audit events) before the response
    // leaves this function. If the flush itself fails we still respond —
    // the write-through adapters have already written through to the
    // cache; the flush is only there to turn the sub-ms "crash before
    // Firestore acks the mirror" window into zero. We log so the caller
    // can observe durability degradation.
    if (options.flushDurableWrites) {
      try {
        await options.flushDurableWrites();
      } catch (error) {
        console.warn(
          "[http-api] flushDurableWrites failed before response",
          error,
        );
      }
    }
    const json = JSON.stringify(payload ?? null);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(json),
      // Authorised, per-operator data: never store it in a shared/intermediate cache.
      "cache-control": "no-store",
      ...(correlationId ? { [corrHeader]: correlationId } : {}),
    });
    res.end(json);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function sanitizeRequestBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (
      k === "mfa" ||
      k === "mfaVerified" ||
      k === "reauth" ||
      k === "reauthVerified" ||
      k === "reauthentication" ||
      k === "approvalSatisfied" ||
      k === "appCheckValid"
    ) {
      continue;
    }
    clean[k] = v;
  }
  return clean;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function notNull<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) {
    throw new NotFoundError("resource not found");
  }
  return value;
}

function statusFilter(params: URLSearchParams): { status?: string } {
  const status = params.get("status");
  return status ? { status } : {};
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  // Firebase HTTPS Functions uses Express and may have parsed the JSON body
  // before this Node-compatible handler runs. Reuse that parsed value instead
  // of attempting to consume the stream twice. Plain Node HTTP requests do
  // not expose `body`, so they keep the existing streamed parsing path.
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined) {
    if (
      !preParsed ||
      typeof preParsed !== "object" ||
      Array.isArray(preParsed)
    ) {
      throw new ValidationError("request body must be a JSON object");
    }
    return sanitizeRequestBody(preParsed as Record<string, unknown>);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) throw new ValidationError("request body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError("request body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("request body must be a JSON object");
  }
  return sanitizeRequestBody(parsed as Record<string, unknown>);
}

/** Non-negative integers from the query string (invalid → ValidationError). */
function boundedInts<K extends string>(
  params: URLSearchParams,
  keys: readonly K[],
): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 100_000) {
      throw new ValidationError(`${key} must be a non-negative integer`);
    }
    out[key] = value;
  }
  return out;
}

function parseTaskQuery(params: URLSearchParams): TaskQuery {
  const q: TaskQuery = {};
  const str = (k: keyof TaskQuery) => {
    const v = params.get(k as string);
    if (v !== null && v !== "") (q[k] as unknown) = v;
  };
  str("taskId");
  str("workflowId");
  str("projectId");
  str("agentId");
  str("status");
  str("priority");
  str("since");
  str("until");
  str("createdAfter");
  str("createdBefore");
  str("cursor");
  if (params.get("failedOnly") === "true") q.failedOnly = true;
  const limit = Number(params.get("limit"));
  if (Number.isFinite(limit) && limit > 0) q.limit = limit;
  return q;
}

function parsePageQuery(params: URLSearchParams): {
  limit?: number;
  cursor?: string;
  planId?: string;
} {
  const q: { limit?: number; cursor?: string; planId?: string } = {};
  const cursor = params.get("cursor");
  if (cursor !== null && cursor !== "") q.cursor = cursor;
  const limit = Number(params.get("limit"));
  if (Number.isFinite(limit) && limit > 0) q.limit = limit;
  const planId = params.get("planId");
  if (planId !== null && planId !== "") q.planId = planId;
  return q;
}

/** `?version=N` — a positive integer, otherwise the current version. */
function parsePlanVersion(params: URLSearchParams): number | undefined {
  const raw = params.get("version");
  if (raw === null || raw === "") return undefined;
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new ValidationError("version must be a positive integer");
  }
  return version;
}

function parseWorkflowQuery(params: URLSearchParams): WorkflowQuery {
  const q: WorkflowQuery = {};
  const projectId = params.get("projectId");
  if (projectId !== null && projectId !== "") q.projectId = projectId;
  const cursor = params.get("cursor");
  if (cursor !== null && cursor !== "") q.cursor = cursor;
  const limit = Number(params.get("limit"));
  if (Number.isFinite(limit) && limit > 0) q.limit = limit;
  return q;
}

function parseAuditQuery(params: URLSearchParams): AuditEventQuery {
  const q: AuditEventQuery = {};
  const str = (k: keyof AuditEventQuery) => {
    const v = params.get(k as string);
    if (v !== null && v !== "") (q[k] as unknown) = v;
  };
  str("type");
  str("agentId");
  str("projectId");
  str("taskId");
  str("workflowId");
  str("toolId");
  str("actor");
  str("correlationId");
  str("outcome");
  str("since");
  str("until");
  str("cursor");
  const limit = Number(params.get("limit"));
  if (Number.isFinite(limit) && limit > 0) q.limit = limit;
  return q;
}
