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
  type IdentityVerifier,
  type OperatorDirectory,
  type OperatorPrincipal,
  type TaskQuery,
  type VerifiedIdentity,
  type WorkflowQuery,
  type WorkforceGraphUnchanged,
} from "../contracts/index.js";
import {
  type WorkforceCommandService,
  type WorkforceQueryService,
} from "../control/index.js";
import { sanitizeCorrelationId } from "../control/correlation.js";
import { parseGraphQueryParams } from "../control/services/graph-query-service.js";
import type { AccessService, ProfileService } from "../core/index.js";

export interface ControlPlaneApiOptions {
  query: WorkforceQueryService;
  graphQuery?: import("../control/index.js").GraphQueryService;
  command: WorkforceCommandService;
  /** PROJECT-2: project onboarding & provisioning (admin-only, governed). */
  onboarding?: import("../control/index.js").OnboardingControlService;
  /** Phase 3: Context Engine + Prompt Intelligence (prepares prompts; never executes). */
  promptIntelligence?: import("../control/index.js").PromptIntelligenceControlService;
  /** Layer 4: Execution Orchestration (plans, routes and gates; runs only through the runtime port). */
  orchestration?: import("../control/index.js").ExecutionOrchestrationControlService;
  /** PROJECT-2: refreshes provisioned projects into the registry (self-throttled). */
  projectSync?: () => Promise<void>;
  operatorDirectory: OperatorDirectory;
  /**
   * AUTHZ-1: verifies a token WITHOUT requiring an active role, for
   * `GET /me/access` only. Every other route still needs `operatorDirectory`.
   */
  identityVerifier?: IdentityVerifier;
  /** AUTHZ-1: serves `GET /me/access` (the caller's own access state). */
  access?: Pick<AccessService, "myAccess">;
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
}

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void;

const ORCHESTRATION_METHODS: Record<
  string,
  | "orchestrationCreate"
  | "orchestrationStart"
  | "orchestrationAdvance"
  | "orchestrationPause"
  | "orchestrationResume"
  | "orchestrationCancel"
  | "orchestrationRetryTask"
> = {
  orchestration_create: "orchestrationCreate",
  orchestration_start: "orchestrationStart",
  orchestration_advance: "orchestrationAdvance",
  orchestration_pause: "orchestrationPause",
  orchestration_resume: "orchestrationResume",
  orchestration_cancel: "orchestrationCancel",
  orchestration_retry_task: "orchestrationRetryTask",
};

const PROMPT_METHODS: Record<string, "promptPrepare" | "promptRequestApproval"> = {
  prompt_prepare: "promptPrepare",
  prompt_request_approval: "promptRequestApproval",
};

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

  return (req, res) => {
    void handle(req, res).catch((error: unknown) => {
      send(res, 500, { error: { message: errorMessage(error) } }, "");
    });
  };

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // The inbound id reaches audit records and the response header: only a well-formed one is kept.
    const correlationId =
      sanitizeCorrelationId(headerValue(req, corrHeader)) ?? newCorrelationId();
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/$/, "");
    const method = (req.method ?? "GET").toUpperCase();

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
    if (method === "GET" && route === "/me/access") {
      const identity = await verifyIdentity(req);
      if (!identity) {
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
      return send(
        res,
        401,
        { error: { message: "authentication required" } },
        correlationId,
      );
    }

    try {
      if (options.projectSync) await options.projectSync();
      if (route.startsWith("/itsm/")) {
        return await handleItsm(route, segs, method, req, res, principal, correlationId);
      }
      if (route.startsWith("/ops/")) {
        return await handleOperations(route, segs, method, req, res, principal, correlationId);
      }
      if (route.startsWith("/grc/")) {
        return await handleGrc(route, segs, method, req, res, principal, correlationId);
      }
      if (route.startsWith("/aigov/")) {
        return await handleAIGovernance(route, segs, method, req, res, principal, correlationId);
      }
      if (route.startsWith("/datagov/")) {
        return await handleDataGovernance(route, segs, method, req, res, principal, correlationId);
      }
      if (route.startsWith("/security/")) {
        return await handleSecurity(route, segs, method, req, res, principal, correlationId);
      }
      if (route.startsWith("/audit/")) {
        return await handleAudit(route, segs, method, req, res, principal, correlationId);
      }
      if (route.startsWith("/portfolio/")) {
        return await handlePortfolio(route, segs, method, req, res, principal, correlationId);
      }
      if (route.startsWith("/product/")) {
        return await handleProduct(route, segs, method, req, res, principal, correlationId);
      }
      if (route.startsWith("/workforce/")) {
        return await handleWorkforce(route, segs, method, req, res, principal, correlationId);
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
        const projectId = typeof body.projectId === "string" ? body.projectId : "";
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
            if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
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
              throw new ValidationError(`tasks[${index}].requirements is required`);
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
        const workload = await query.getProjectWorkforce(principal, projectId, tasks);
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
    if (!options.identityVerifier) return null;
    const header = headerValue(req, "authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return null;
    return options.identityVerifier.verify(match[1]!.trim());
  }

  async function authenticate(
    req: IncomingMessage,
  ): Promise<OperatorPrincipal | null> {
    const header = headerValue(req, "authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return null;
    return operatorDirectory.resolve(match[1]!.trim());
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
      case "execution-runs": {
        const orchestration = options.orchestration;
        if (!orchestration) throw new NotFoundError("resource not found");
        if (!id) {
          const limit = Number(params.get("limit") ?? "50");
          return send(
            res,
            200,
            {
              runs: orchestration.list(principal, {
                ...(params.get("projectId") ? { projectId: params.get("projectId")! } : {}),
                ...(Number.isInteger(limit) ? { limit } : {}),
              }),
            },
            correlationId,
          );
        }
        if (segs.length === 2) {
          return send(res, 200, await orchestration.get(principal, id), correlationId);
        }
        throw new NotFoundError("resource not found");
      }
      case "prompt-intelligence": {
        const promptIntelligence = options.promptIntelligence;
        if (!promptIntelligence) throw new NotFoundError("resource not found");
        if (!id) {
          const limit = Number(params.get("limit") ?? "50");
          return send(
            res,
            200,
            {
              requests: promptIntelligence.list(principal, {
                ...(params.get("projectId") ? { projectId: params.get("projectId")! } : {}),
                ...(Number.isInteger(limit) ? { limit } : {}),
              }),
            },
            correlationId,
          );
        }
        if (segs.length === 2) {
          return send(res, 200, promptIntelligence.get(principal, id), correlationId);
        }
        throw new NotFoundError("resource not found");
      }
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
        if (segs.length === 4 && segs[1] === "assignments" && segs[3] === "history") {
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
        return send(res, 404, { error: { message: "not found" } }, correlationId);
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
    if (!options.itsm) return send(res, 404, { error: { message: "itsm not found" } }, correlationId);
    
    try {
      if (segs[1] === "services") {
        if (method === "GET") {
          return send(res, 200, await options.itsm.listServices(principal.id), correlationId);
        } else if (method === "POST") {
          const body = await readJsonBody(req, maxBody);
          return send(res, 200, await options.itsm.createService(body as any), correlationId);
        }
      }
      
      if (segs[1] === "incidents") {
        if (method === "GET") {
          const serviceId = new URL(req.url ?? "/", "http://localhost").searchParams.get("serviceId");
          return send(res, 200, await options.itsm.listIncidents(principal.id, serviceId || undefined), correlationId);
        } else if (method === "POST") {
          const body = await readJsonBody(req, maxBody);
          return send(res, 200, await options.itsm.createIncident(body as any), correlationId);
        }
      }
      
      if (segs[1] === "changes") {
        if (method === "GET") {
          return send(res, 200, await options.itsm.listChangeRequests(principal.id), correlationId);
        } else if (method === "POST") {
          const body = await readJsonBody(req, maxBody);
          return send(res, 200, await options.itsm.createChangeRequest(body as any), correlationId);
        }
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
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
    if (!options.ops) return send(res, 404, { error: { message: "ops not available" } }, correlationId);
    
    try {
      if (segs[1] === "health") {
        if (method === "GET") {
          return send(res, 200, await options.ops.getGlobalHealth(), correlationId);
        } else if (method === "POST") {
          const body = await readJsonBody(req, maxBody);
          return send(res, 200, await options.ops.reportHealth(principal, body as any), correlationId);
        }
      }

      if (segs[1] === "alerts") {
        if (method === "GET") {
          return send(res, 200, await options.ops.listAlerts(), correlationId);
        }
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
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
    if (!options.grc) return send(res, 404, { error: { message: "grc not available" } }, correlationId);
    
    try {
      if (segs[1] === "frameworks" && method === "GET") {
        return send(res, 200, await options.grc.listFrameworks(), correlationId);
      }
      if (segs[1] === "risks" && method === "GET") {
        return send(res, 200, await options.grc.listRisks("global"), correlationId);
      }
      if (segs[1] === "trust-content" && method === "GET") {
        return send(res, 200, await options.grc.listTrustCenterContent(), correlationId);
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
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
    if (!options.aiGov) return send(res, 404, { error: { message: "ai governance not available" } }, correlationId);
    
    try {
      if (segs[1] === "models" && method === "GET") {
        return send(res, 200, await options.aiGov.listModels(), correlationId);
      }
      if (segs[1] === "use-cases" && method === "GET") {
        // Simple global fetch for prototype
        return send(res, 200, await options.aiGov.listUseCases("global"), correlationId);
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
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
    if (!options.dataGov) return send(res, 404, { error: { message: "data governance not available" } }, correlationId);
    
    try {
      if (segs[1] === "assets" && method === "GET") {
        return send(res, 200, await options.dataGov.listAssets(), correlationId);
      }
      if (segs[1] === "retention-policies" && method === "GET") {
        return send(res, 200, await options.dataGov.listRetentionPolicies(), correlationId);
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
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
    if (!options.security) return send(res, 404, { error: { message: "security not available" } }, correlationId);
    
    try {
      if (segs[1] === "events" && method === "GET") {
        return send(res, 200, await options.security.listEvents(), correlationId);
      }
      if (segs[1] === "policies" && method === "GET") {
        return send(res, 200, await options.security.listPolicies(), correlationId);
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
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
    if (!options.audit) return send(res, 404, { error: { message: "audit not available" } }, correlationId);
    
    try {
      if (segs[1] === "logs" && method === "GET") {
        return send(res, 200, await options.audit.listAuditLogs(), correlationId);
      }
      if (segs[1] === "findings" && method === "GET") {
        return send(res, 200, await options.audit.listFindings(), correlationId);
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
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
    if (!options.portfolio) return send(res, 404, { error: { message: "portfolio not available" } }, correlationId);
    
    try {
      if (segs[1] === "portfolios" && method === "GET") {
        return send(res, 200, await options.portfolio.listPortfolios(), correlationId);
      }
      if (segs[1] === "programs" && method === "GET") {
        return send(res, 200, await options.portfolio.listPrograms(), correlationId);
      }
      if (segs[1] === "objectives" && method === "GET") {
        return send(res, 200, await options.portfolio.listObjectives(), correlationId);
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
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
    if (!options.product) return send(res, 404, { error: { message: "product not available" } }, correlationId);
    
    try {
      if (segs[1] === "products" && method === "GET") {
        return send(res, 200, await options.product.listProducts(), correlationId);
      }
      if (segs[1] === "problems" && method === "GET") {
        return send(res, 200, await options.product.listProblems(), correlationId);
      }
      if (segs[1] === "features" && method === "GET") {
        return send(res, 200, await options.product.listFeatures(), correlationId);
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
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
    if (!options.workforce) return send(res, 404, { error: { message: "workforce not available" } }, correlationId);
    
    try {
      if (segs[1] === "departments" && method === "GET") {
        return send(res, 200, await options.workforce.listDepartments(), correlationId);
      }
      if (segs[1] === "teams" && method === "GET") {
        return send(res, 200, await options.workforce.listTeams(), correlationId);
      }
      if (segs[1] === "agents" && method === "GET") {
        return send(res, 200, await options.workforce.listAgents(), correlationId);
      }

      return send(res, 404, { error: { message: "not found" } }, correlationId);
    } catch (e) {
      return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
    }
  }

  /**
   * `GET /me/profile`, `PUT /me/profile/photo` {dataUrl},
   * `DELETE /me/profile/photo` — always the principal's own profile.
   */
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
    if (name.startsWith("orchestration_") && options.orchestration) {
      const orchestration = options.orchestration;
      const method = Object.hasOwn(ORCHESTRATION_METHODS, name) ? ORCHESTRATION_METHODS[name] : undefined;
      if (!method) {
        return send(res, 404, { error: { message: `unknown command: ${name}` } }, correlationId);
      }
      let payload: Record<string, unknown>;
      try {
        payload = await readJsonBody(req, maxBody);
      } catch (error) {
        return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
      }
      const fn = orchestration[method] as (
        p: OperatorPrincipal,
        input: Record<string, unknown>,
        opts: { correlationId: string },
      ) => Promise<{ errorKind?: ControlErrorKind }>;
      const outcome = await fn.call(orchestration, principal, payload, { correlationId });
      return send(res, outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200, outcome, correlationId);
    }
    if (name.startsWith("prompt_") && options.promptIntelligence) {
      const promptIntelligence = options.promptIntelligence;
      const method = Object.hasOwn(PROMPT_METHODS, name) ? PROMPT_METHODS[name] : undefined;
      if (!method) {
        return send(res, 404, { error: { message: `unknown command: ${name}` } }, correlationId);
      }
      let payload: Record<string, unknown>;
      try {
        payload = await readJsonBody(req, maxBody);
      } catch (error) {
        return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
      }
      const fn = promptIntelligence[method] as (
        p: OperatorPrincipal,
        input: Record<string, unknown>,
        opts: { correlationId: string },
      ) => Promise<{ errorKind?: ControlErrorKind }>;
      const outcome = await fn.call(promptIntelligence, principal, payload, { correlationId });
      return send(res, outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200, outcome, correlationId);
    }
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
    const fn = command[methodName] as (
      p: OperatorPrincipal,
      input: unknown,
      opts: { correlationId: string },
    ) => Promise<{ errorKind?: ControlErrorKind }>;
    const result = await fn.call(command, principal, body, { correlationId });
    const status = result.errorKind ? ERROR_KIND_STATUS[result.errorKind] : 200;
    return send(res, status, result, correlationId);
  }

  function send(
    res: ServerResponse,
    status: number,
    payload: unknown,
    correlationId: string,
  ): void {
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
    return preParsed as Record<string, unknown>;
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
  return parsed as Record<string, unknown>;
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


