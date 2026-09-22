import { NotFoundError, PermissionDeniedError, StateTransitionError, ValidationError, WorkforceError, } from "../contracts/index.js";
const ERROR_KIND_STATUS = {
    invalid_request: 400,
    unauthorized: 401,
    forbidden: 403,
    not_found: 404,
    invalid_state: 409,
    approval_failure: 422,
    command_failure: 500,
};
const COMMAND_METHODS = {
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
function defaultCorrelationId() {
    const c = globalThis.crypto;
    return c?.randomUUID ? c.randomUUID() : `corr_${Date.now()}_${Math.random()}`;
}
function statusForError(error) {
    if (error instanceof ValidationError)
        return 400;
    if (error instanceof PermissionDeniedError)
        return 403;
    if (error instanceof NotFoundError)
        return 404;
    if (error instanceof StateTransitionError)
        return 409;
    if (error instanceof WorkforceError)
        return 409;
    return 500;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : "internal error";
}
export function createControlPlaneApi(options) {
    const base = (options.basePath ?? "/api").replace(/\/$/, "");
    const corrHeader = (options.correlationHeader ?? "x-correlation-id").toLowerCase();
    const newCorrelationId = options.generateCorrelationId ?? defaultCorrelationId;
    const maxBody = options.maxBodyBytes ?? 1_048_576;
    const { query, command, operatorDirectory } = options;
    return (req, res) => {
        void handle(req, res).catch((error) => {
            send(res, 500, { error: { message: errorMessage(error) } }, "");
        });
    };
    async function handle(req, res) {
        const correlationId = headerValue(req, corrHeader)?.trim() || newCorrelationId();
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
            return send(res, 401, { error: { message: "authentication required" } }, correlationId);
        }
        try {
            if (method === "GET") {
                return await handleGet(res, segs, url.searchParams, principal, correlationId);
            }
            if (method === "POST" && segs[0] === "commands" && segs.length === 2) {
                return await handleCommand(req, res, segs[1], principal, correlationId);
            }
            return send(res, method === "POST" ? 404 : 405, { error: { message: "not found" } }, correlationId);
        }
        catch (error) {
            return send(res, statusForError(error), { error: { message: errorMessage(error) } }, correlationId);
        }
    }
    async function authenticate(req) {
        const header = headerValue(req, "authorization") ?? "";
        const match = /^Bearer\s+(.+)$/i.exec(header.trim());
        if (!match)
            return null;
        return operatorDirectory.resolve(match[1].trim());
    }
    async function handleGet(res, segs, params, principal, correlationId) {
        const [head, id] = segs;
        switch (head) {
            case "status":
                return send(res, 200, query.getWorkforceStatus(principal), correlationId);
            case "system-health":
                return send(res, 200, query.getSystemHealth(principal), correlationId);
            case "dashboard":
                return send(res, 200, await query.getDashboardSnapshot(principal), correlationId);
            case "agents":
                return send(res, 200, id
                    ? notNull(query.getAgent(principal, id))
                    : query.getAgents(principal), correlationId);
            case "tasks":
                return send(res, 200, id
                    ? notNull(query.getTask(principal, id))
                    : query.getTasks(principal, parseTaskQuery(params)), correlationId);
            case "workflows":
                return send(res, 200, id
                    ? notNull(query.getWorkflow(principal, id))
                    : query.getWorkflows(principal, parseWorkflowQuery(params)), correlationId);
            case "approvals":
                return send(res, 200, query.getApprovals(principal, statusFilter(params)), correlationId);
            case "projects":
                // `GET /projects/:projectId/agents` — nested project resource route.
                if (segs.length === 3 && segs[2] === "agents") {
                    return send(res, 200, notNull(await query.getProjectAgents(principal, id)), correlationId);
                }
                if (segs.length >= 3) {
                    return send(res, 404, { error: { message: "not found" } }, correlationId);
                }
                return send(res, 200, id
                    ? notNull(await query.getProject(principal, id))
                    : await query.getProjects(principal), correlationId);
            case "tools":
                return send(res, 200, id
                    ? notNull(query.getTool(principal, id))
                    : query.getTools(principal), correlationId);
            case "audit":
                return send(res, 200, query.getAuditEvents(principal, parseAuditQuery(params)), correlationId);
            default:
                return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
    }
    async function handleCommand(req, res, name, principal, correlationId) {
        const methodName = COMMAND_METHODS[name];
        if (!methodName) {
            return send(res, 404, { error: { message: `unknown command: ${name}` } }, correlationId);
        }
        let body;
        try {
            body = await readJsonBody(req, maxBody);
        }
        catch (error) {
            return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
        }
        const fn = command[methodName];
        const result = await fn.call(command, principal, body, { correlationId });
        const status = result.errorKind ? ERROR_KIND_STATUS[result.errorKind] : 200;
        return send(res, status, result, correlationId);
    }
    function send(res, status, payload, correlationId) {
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
function headerValue(req, name) {
    const raw = req.headers[name];
    return Array.isArray(raw) ? raw[0] : raw;
}
function notNull(value) {
    if (value === undefined || value === null) {
        throw new NotFoundError("resource not found");
    }
    return value;
}
function statusFilter(params) {
    const status = params.get("status");
    return status ? { status } : {};
}
async function readJsonBody(req, maxBytes) {
    // Firebase HTTPS Functions uses Express and may have parsed the JSON body
    // before this Node-compatible handler runs. Reuse that parsed value instead
    // of attempting to consume the stream twice. Plain Node HTTP requests do
    // not expose `body`, so they keep the existing streamed parsing path.
    const preParsed = req.body;
    if (preParsed !== undefined) {
        if (!preParsed ||
            typeof preParsed !== "object" ||
            Array.isArray(preParsed)) {
            throw new ValidationError("request body must be a JSON object");
        }
        return preParsed;
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = chunk;
        total += buf.length;
        if (total > maxBytes)
            throw new ValidationError("request body too large");
        chunks.push(buf);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text === "")
        return {};
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new ValidationError("request body is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ValidationError("request body must be a JSON object");
    }
    return parsed;
}
function parseTaskQuery(params) {
    const q = {};
    const str = (k) => {
        const v = params.get(k);
        if (v !== null && v !== "")
            q[k] = v;
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
    if (params.get("failedOnly") === "true")
        q.failedOnly = true;
    const limit = Number(params.get("limit"));
    if (Number.isFinite(limit) && limit > 0)
        q.limit = limit;
    return q;
}
function parseWorkflowQuery(params) {
    const q = {};
    const projectId = params.get("projectId");
    if (projectId !== null && projectId !== "")
        q.projectId = projectId;
    const cursor = params.get("cursor");
    if (cursor !== null && cursor !== "")
        q.cursor = cursor;
    const limit = Number(params.get("limit"));
    if (Number.isFinite(limit) && limit > 0)
        q.limit = limit;
    return q;
}
function parseAuditQuery(params) {
    const q = {};
    const str = (k) => {
        const v = params.get(k);
        if (v !== null && v !== "")
            q[k] = v;
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
    if (Number.isFinite(limit) && limit > 0)
        q.limit = limit;
    return q;
}
