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
  type OperatorDirectory,
  type OperatorPrincipal,
  type TaskQuery,
} from "../contracts/index.js";
import {
  type WorkforceCommandService,
  type WorkforceQueryService,
} from "../control/index.js";

export interface ControlPlaneApiOptions {
  query: WorkforceQueryService;
  command: WorkforceCommandService;
  operatorDirectory: OperatorDirectory;
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
      if (method === "GET") {
        return await handleGet(
          res,
          segs,
          url.searchParams,
          principal,
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
            : query.getWorkflows(principal),
          correlationId,
        );
      case "approvals":
        return send(
          res,
          200,
          query.getApprovals(principal, statusFilter(params)),
          correlationId,
        );
      case "projects":
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
      case "audit":
        return send(
          res,
          200,
          query.getAuditEvents(principal, parseAuditQuery(params)),
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
