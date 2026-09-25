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
  WorkforceError,
  type AuditEventQuery,
  type ControlErrorKind,
  type IdentityVerifier,
  type OperatorDirectory,
  type OperatorPrincipal,
  type TaskQuery,
  type VerifiedIdentity,
  type WorkflowQuery,
} from "../contracts/index.js";
import {
  type WorkforceCommandService,
  type WorkforceQueryService,
} from "../control/index.js";
import type { AccessService, ProfileService } from "../core/index.js";

export interface ControlPlaneApiOptions {
  query: WorkforceQueryService;
  command: WorkforceCommandService;
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
  /** Path prefix for every route. Default `/api`. */
  basePath?: string;
  /** Request header carrying an inbound correlation id. Default `x-correlation-id`. */
  correlationHeader?: string;
  generateCorrelationId?: () => string;
  /** Max JSON request body size in bytes. Default 1 MiB. */
  maxBodyBytes?: number;
}

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void;

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
  "create-program": "createProgram",
  "create-workstream": "createWorkstream",
  "add-workstream-task": "addTaskToWorkstream",
  "tick-software-factory": "tickSoftwareFactory",
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
    const correlationId =
      headerValue(req, corrHeader)?.trim() || newCorrelationId();
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
    const methodName = COMMAND_METHODS[name];
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
