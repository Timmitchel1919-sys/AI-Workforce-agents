import { processSecurityLayer } from "./security/middleware.js";
import { ApiSecurityError } from "./security/errors.js";
import { NotFoundError, PermissionDeniedError, StateTransitionError, ValidationError, WorkforceError, ROLE_CAPABILITIES, } from "../contracts/index.js";
import { sanitizeCorrelationId } from "../control/correlation.js";
import { parseGraphQueryParams } from "../control/services/graph-query-service.js";
const RUNTIME_METHODS = {
    runtime_cancel_session: "runtimeCancelSession",
    runtime_pause_session: "runtimePauseSession",
    runtime_resume_session: "runtimeResumeSession",
};
const ORCHESTRATION_METHODS = {
    orchestration_create: "orchestrationCreate",
    orchestration_start: "orchestrationStart",
    orchestration_advance: "orchestrationAdvance",
    orchestration_pause: "orchestrationPause",
    orchestration_resume: "orchestrationResume",
    orchestration_cancel: "orchestrationCancel",
    orchestration_retry_task: "orchestrationRetryTask",
};
const PROMPT_METHODS = {
    prompt_prepare: "promptPrepare",
    prompt_request_approval: "promptRequestApproval",
};
const ONBOARDING_METHODS = {
    onboarding_create: "onboardingCreate",
    onboarding_update: "onboardingUpdate",
    onboarding_analyze: "onboardingAnalyze",
    onboarding_plan: "onboardingPlan",
    onboarding_approve_plan: "onboardingApprovePlan",
    onboarding_provision: "onboardingProvision",
    onboarding_revalidate: "onboardingRevalidate",
    onboarding_cancel: "onboardingCancel",
};
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
        void (async () => {
            let correlationId = "";
            try {
                correlationId = sanitizeCorrelationId(headerValue(req, corrHeader)) ?? newCorrelationId();
                const ctx = await processSecurityLayer(req, res, {
                    identityVerifier: options.identityVerifier,
                    operatorDirectory: options.operatorDirectory,
                    appAttestationVerifier: options.appAttestationVerifier,
                    appCheckMode: options.appCheckMode,
                    correlationId
                });
                req._secureCtx = ctx;
                await handle(req, res, ctx, correlationId);
            }
            catch (error) {
                if (error === "PREFLIGHT_HANDLED")
                    return;
                if (error instanceof ApiSecurityError) {
                    send(res, error.status, { error: { code: error.code, message: error.message, correlationId } }, correlationId);
                }
                else {
                    send(res, 500, { error: { message: errorMessage(error) } }, correlationId);
                }
            }
        })();
    };
    async function handle(req, res, ctx, correlationId) {
        const path = ctx.path;
        const method = ctx.method;
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!path.startsWith(base + "/") && path !== base) {
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        const route = path.slice(base.length) || "/";
        const segs = route.split("/").filter(Boolean);
        // Liveness — no auth.
        if (method === "GET" && segs.length === 1 && segs[0] === "health") {
            return send(res, 200, { status: "ok" }, correlationId);
        }
        // Signed provider webhooks — no operator token: the HMAC signature IS the authentication.
        if (method === "POST" &&
            segs.length === 3 &&
            segs[0] === "integrations" &&
            segs[1] === "webhooks" &&
            options.integrationCenter) {
            let raw;
            try {
                raw = await readRawBody(req, 256_000);
            }
            catch {
                return send(res, 413, { error: "payload too large" }, correlationId);
            }
            const out = await options.integrationCenter.receiveWebhook(segs[2], req.headers, raw);
            return send(res, out.status, out.body, correlationId);
        }
        // `GET /me/access` — the signed-in user's own access state. Needs only a
        // verified identity (authentication), never an active role: this is how
        // a pending user learns they are pending. Creates a PENDING request on
        // first contact; grants nothing.
        if (method === "GET" && route === "/me/access") {
            const identity = ctx.identity;
            if (!identity) {
                return send(res, 401, { error: { message: "authentication required" } }, correlationId);
            }
            if (!options.access) {
                return send(res, 404, { error: { message: "not found" } }, correlationId);
            }
            try {
                return send(res, 200, await options.access.myAccess(identity), correlationId);
            }
            catch (error) {
                return send(res, statusForError(error), { error: { message: errorMessage(error) } }, correlationId);
            }
        }
        // Authenticate every other route.
        const principal = ctx.principal;
        if (!principal) {
            return send(res, 401, { error: { message: "authentication required" } }, correlationId);
        }
        try {
            if (options.projectSync)
                await options.projectSync();
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
            if (route === "/knowledge-items" || route.startsWith("/knowledge-items/")) {
                return await handleKnowledge(req, res, segs, method, url.searchParams, principal, correlationId);
            }
            if (route === "/simulation" || route.startsWith("/simulation/")) {
                return await handleSimulation(req, res, segs, method, url.searchParams, principal, correlationId);
            }
            if (route === "/trust" || route.startsWith("/trust/")) {
                return await handleTrust(req, res, segs, method, url.searchParams, principal, correlationId);
            }
            if (route === "/me/profile" || route === "/me/profile/photo") {
                return await handleProfile(req, res, route, method, principal, correlationId);
            }
            if (method === "GET") {
                return await handleGet(res, segs, url.searchParams, principal, correlationId);
            }
            if (method === "POST" && route === "/execution/preflight") {
                // EO-4.1: evaluation only. There is no execute / shell endpoint.
                let body;
                try {
                    body = await readJsonBody(req, maxBody);
                }
                catch (error) {
                    return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
                }
                return send(res, 200, notNull(await query.executionPreflight(principal, body)), correlationId);
            }
            // `POST /workforce/plan` — the honest staffing answer for a project.
            // Always a DRY RUN: this endpoint plans and reports, it never binds an
            // agent to work. Creating an assignment is a host-side decision, not a
            // side effect of a read.
            if (method === "POST" && route === "/workforce/plan") {
                let body;
                try {
                    body = await readJsonBody(req, maxBody);
                }
                catch (error) {
                    return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
                }
                const projectId = typeof body.projectId === "string" ? body.projectId : "";
                if (!projectId) {
                    return send(res, 400, { error: { message: "projectId is required" } }, correlationId);
                }
                // A malformed `tasks` field must be REJECTED, not treated as "no tasks".
                // Defaulting it to `[]` answered "fully staffed" for a request that never
                // described any work, which is a staffing claim the caller did not ask
                // for and the server cannot support.
                if (!Array.isArray(body.tasks)) {
                    return send(res, 400, { error: { message: "tasks must be an array" } }, correlationId);
                }
                const rawTasks = body.tasks;
                let tasks;
                try {
                    tasks = rawTasks.map((entry, index) => {
                        if (typeof entry !== "object" ||
                            entry === null ||
                            Array.isArray(entry)) {
                            throw new ValidationError(`tasks[${index}] must be an object`);
                        }
                        const record = entry;
                        if (typeof record.taskId !== "string" || !record.taskId) {
                            throw new ValidationError(`tasks[${index}].taskId is required`);
                        }
                        if (typeof record.requirements !== "object" ||
                            record.requirements === null ||
                            Array.isArray(record.requirements)) {
                            throw new ValidationError(`tasks[${index}].requirements is required`);
                        }
                        return {
                            taskId: record.taskId,
                            requirements: record.requirements,
                        };
                    });
                }
                catch (error) {
                    return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
                }
                const workload = await query.getProjectWorkforce(principal, projectId, tasks);
                if (!workload) {
                    return send(res, 404, {
                        error: {
                            message: "specialist workforce is not composed, or the project is not accessible",
                        },
                    }, correlationId);
                }
                return send(res, 200, workload, correlationId);
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
    async function verifyIdentity(req) {
        if (!options.identityVerifier)
            return null;
        const header = headerValue(req, "authorization") ?? "";
        const match = /^Bearer\s+(.+)$/i.exec(header.trim());
        if (!match)
            return null;
        return options.identityVerifier.verify(match[1].trim());
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
        if (head &&
            [
                "portfolio-intelligence",
                "operations-center",
                "analytics-intelligence",
                "business-layer",
            ].includes(head))
            await options.refreshData?.();
        switch (head) {
            case "trust": {
                const security = options.trustCenter;
                if (!security)
                    throw new NotFoundError("resource not found");
                const [, area, itemId] = segs;
                const projectId = params.get("projectId") ?? undefined;
                const result = await (async () => {
                    switch (area) {
                        case "overview":
                            return security.overview(principal, projectId);
                        case "policies":
                            return itemId
                                ? security.policy(principal, itemId)
                                : security.policies(principal);
                        case "trust":
                            return security.trust(principal);
                        case "approvals":
                            return itemId
                                ? security.approval(principal, itemId)
                                : security.approvals(principal, params);
                        case "alerts":
                            return itemId
                                ? security.alert(principal, itemId)
                                : security.alerts(principal, params);
                        case "ledger":
                            return security.ledger(principal, params);
                        case "simulate":
                            return security.simulate(principal, params);
                        case "secrets":
                            return security.secrets(principal);
                        case "project":
                            return security.projectSecurity(principal, projectId ?? "");
                        default:
                            throw new NotFoundError("resource not found");
                    }
                })();
                return send(res, 200, result, correlationId);
            }
            case "extensions-platform": {
                const hub = options.extensionCenter;
                if (!hub)
                    throw new NotFoundError("resource not found");
                const [, area, itemId] = segs;
                const result = (() => {
                    switch (area) {
                        case undefined:
                        case "overview":
                            return hub.overview(principal);
                        case "extension":
                            return hub.extension(principal, itemId ?? "");
                        case "audit":
                            return hub.audit(principal, params.get("extensionId") ?? undefined);
                        default:
                            throw new NotFoundError("resource not found");
                    }
                })();
                return send(res, 200, result, correlationId);
            }
            case "business-layer": {
                const hub = options.businessCenter;
                if (!hub)
                    throw new NotFoundError("resource not found");
                const [, area, itemId] = segs;
                const result = (() => {
                    switch (area) {
                        case undefined:
                        case "overview":
                            return hub.overview(principal);
                        case "objectives":
                            return hub.objectives(principal, params);
                        case "objective":
                            return hub.objective(principal, itemId ?? "");
                        case "initiatives":
                            return hub.initiatives(principal, params.get("objectiveId") ?? undefined);
                        case "decisions":
                            return hub.decisions(principal, params);
                        default:
                            throw new NotFoundError("resource not found");
                    }
                })();
                return send(res, 200, result, correlationId);
            }
            case "portfolio-intelligence": {
                const hub = options.portfolioCenter;
                if (!hub)
                    throw new NotFoundError("resource not found");
                const [, area, itemId] = segs;
                const result = (() => {
                    switch (area) {
                        case undefined:
                        case "dashboard":
                            return hub.dashboard(principal);
                        case "projects":
                            return hub.projects(principal, params.get("archived") === "true");
                        case "project":
                            return hub.project(principal, itemId ?? "");
                        case "health":
                            return hub.health(principal, itemId ?? "");
                        case "priorities":
                            return hub.priorities(principal);
                        case "conflicts":
                            return hub.conflicts(principal);
                        case "dependencies":
                            return hub.dependencies(principal);
                        case "ask":
                            return hub.ask(principal, params.get("q") ?? "");
                        case "knowledge":
                            return hub.knowledge(principal);
                        default:
                            throw new NotFoundError("resource not found");
                    }
                })();
                return send(res, 200, result, correlationId);
            }
            case "operations-center": {
                const hub = options.operationsCenter;
                if (!hub)
                    throw new NotFoundError("resource not found");
                const [, area, itemId] = segs;
                const result = (() => {
                    switch (area) {
                        case undefined:
                        case "overview":
                            return hub.operations(principal);
                        case "instances":
                            return hub.instances(principal, params);
                        case "instance":
                            return hub.instance(principal, itemId ?? "");
                        case "catalog":
                            return hub.catalog(principal);
                        case "level":
                            return hub.levelFor(principal, params.get("projectId") ?? "");
                        case "audit":
                            return hub.audit(principal, params);
                        default:
                            throw new NotFoundError("resource not found");
                    }
                })();
                return send(res, 200, result, correlationId);
            }
            case "analytics-intelligence": {
                const hub = options.analyticsCenter;
                if (!hub)
                    throw new NotFoundError("resource not found");
                const [, area, itemId] = segs;
                const projectId = params.get("projectId") ?? undefined;
                const result = (() => {
                    switch (area) {
                        case undefined:
                        case "overview":
                            return hub.overview(principal);
                        case "agents":
                            return hub.agents(principal);
                        case "workflows":
                            return hub.workflows(principal, projectId);
                        case "project":
                            return hub.project(principal, itemId ?? "");
                        case "cost":
                            return hub.cost(principal, projectId);
                        case "bottlenecks":
                            return hub.bottlenecks(principal);
                        case "predictions":
                            return hub.predictions(principal);
                        case "recommendations":
                            return hub.recommendations(principal, params.get("status") ?? undefined);
                        case "lessons":
                            return hub.lessons(principal);
                        default:
                            throw new NotFoundError("resource not found");
                    }
                })();
                return send(res, 200, result, correlationId);
            }
            case "integration-center": {
                const hub = options.integrationCenter;
                if (!hub)
                    throw new NotFoundError("resource not found");
                const [, area, itemId] = segs;
                const projectId = params.get("projectId") ?? undefined;
                const result = (() => {
                    switch (area) {
                        case "overview":
                            return hub.overview(principal, projectId);
                        case "connectors":
                            return itemId
                                ? hub.connector(principal, itemId)
                                : hub.overview(principal, projectId).connectors;
                        case "capabilities":
                            return hub.capabilities(principal, params);
                        case "discover":
                            return hub.discover(principal, projectId ?? "");
                        case "events":
                            return hub.events(principal, params);
                        case "activity":
                            return hub.activity(principal, params);
                        case "health":
                            return hub.health(principal);
                        case "mcp":
                            return hub.mcp(principal);
                        case "credentials":
                            return hub.credentials(principal);
                        case "audit":
                            return hub.audit(principal, params);
                        case "mappings":
                            return hub.mappings(principal, projectId);
                        default:
                            throw new NotFoundError("resource not found");
                    }
                })();
                return send(res, 200, result, correlationId);
            }
            case "knowledge": {
                const knowledge = options.knowledgeMemory;
                if (!knowledge)
                    throw new NotFoundError("resource not found");
                const [, area, memoryId] = segs;
                const projectId = params.get("projectId") ?? undefined;
                const result = (() => {
                    switch (area) {
                        case "overview":
                            return knowledge.overview(principal, projectId);
                        case "memories":
                            return memoryId
                                ? knowledge.detail(principal, memoryId)
                                : knowledge.list(principal, params);
                        case "search":
                            return knowledge.search(principal, params);
                        case "graph":
                            return knowledge.graph(principal, params);
                        case "conflicts":
                            return knowledge.conflicts(principal, projectId);
                        case "documents":
                            return knowledge.documents(principal, projectId);
                        case "decisions":
                            return knowledge.decisions(principal, projectId);
                        case "candidates":
                            return knowledge.candidates(principal, projectId);
                        case "health":
                            return knowledge.health(principal, projectId);
                        case "findings":
                            return knowledge.findings(principal, projectId);
                        case "context":
                            return knowledge.context(principal, params);
                        default:
                            throw new NotFoundError("resource not found");
                    }
                })();
                return send(res, 200, result, correlationId);
            }
            case "runtime": {
                const runtime = options.runtime;
                if (!runtime)
                    throw new NotFoundError("resource not found");
                const [, area, executionId, sub] = segs;
                if (area === "overview" && segs.length === 2) {
                    return send(res, 200, runtime.overview(principal), correlationId);
                }
                if (area !== "sessions")
                    throw new NotFoundError("resource not found");
                if (!executionId) {
                    const limit = Number(params.get("limit") ?? "50");
                    return send(res, 200, {
                        sessions: runtime.list(principal, {
                            ...(params.get("projectId")
                                ? { projectId: params.get("projectId") }
                                : {}),
                            ...(params.get("runId") ? { runId: params.get("runId") } : {}),
                            ...(Number.isInteger(limit) ? { limit } : {}),
                        }),
                    }, correlationId);
                }
                if (!sub)
                    return send(res, 200, runtime.get(principal, executionId), correlationId);
                if (sub === "events") {
                    const after = Number(params.get("after") ?? "0");
                    const wait = Number(params.get("wait") ?? "0");
                    return send(res, 200, await runtime.events(principal, executionId, after, Number.isFinite(wait) ? wait : 0), correlationId);
                }
                if (sub === "workspace")
                    return send(res, 200, await runtime.workspace(principal, executionId), correlationId);
                if (sub === "tree") {
                    return send(res, 200, await runtime.tree(principal, executionId, params.get("dir") ?? undefined), correlationId);
                }
                if (sub === "file") {
                    return send(res, 200, await runtime.file(principal, executionId, params.get("path") ?? ""), correlationId);
                }
                throw new NotFoundError("resource not found");
            }
            case "execution-runs": {
                const orchestration = options.orchestration;
                if (!orchestration)
                    throw new NotFoundError("resource not found");
                if (!id) {
                    const limit = Number(params.get("limit") ?? "50");
                    return send(res, 200, {
                        runs: orchestration.list(principal, {
                            ...(params.get("projectId")
                                ? { projectId: params.get("projectId") }
                                : {}),
                            ...(Number.isInteger(limit) ? { limit } : {}),
                        }),
                    }, correlationId);
                }
                if (segs.length === 2) {
                    return send(res, 200, await orchestration.get(principal, id), correlationId);
                }
                throw new NotFoundError("resource not found");
            }
            case "prompt-intelligence": {
                const promptIntelligence = options.promptIntelligence;
                if (!promptIntelligence)
                    throw new NotFoundError("resource not found");
                if (!id) {
                    const limit = Number(params.get("limit") ?? "50");
                    return send(res, 200, {
                        requests: promptIntelligence.list(principal, {
                            ...(params.get("projectId")
                                ? { projectId: params.get("projectId") }
                                : {}),
                            ...(Number.isInteger(limit) ? { limit } : {}),
                        }),
                    }, correlationId);
                }
                if (segs.length === 2) {
                    return send(res, 200, promptIntelligence.get(principal, id), correlationId);
                }
                throw new NotFoundError("resource not found");
            }
            case "onboarding": {
                const onboarding = options.onboarding;
                if (!onboarding)
                    throw new NotFoundError("resource not found");
                if (id === "capabilities" && segs.length === 2) {
                    return send(res, 200, onboarding.capabilities(principal), correlationId);
                }
                if (!id) {
                    return send(res, 200, { sessions: await onboarding.list(principal) }, correlationId);
                }
                if (segs.length === 2) {
                    return send(res, 200, await onboarding.get(principal, id), correlationId);
                }
                throw new NotFoundError("resource not found");
            }
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
                        return send(res, 404, { error: { message: "specialist workforce is not composed" } }, correlationId);
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
                if (segs.length === 4 &&
                    segs[1] === "assignments" &&
                    segs[3] === "history") {
                    const taskId = segs[2];
                    const history = query.getAssignmentHistory(principal, taskId);
                    if (!history) {
                        return send(res, 404, {
                            error: {
                                message: "specialist workforce is not composed, or the task is not accessible",
                            },
                        }, correlationId);
                    }
                    return send(res, 200, history, correlationId);
                }
                // `/api/workforce/handoffs` — transfers and their destination evidence.
                if (segs.length === 2 && segs[1] === "handoffs") {
                    const handoffs = query.getSpecialistHandoffs(principal, {
                        taskId: params.get("taskId") ?? undefined,
                    });
                    if (!handoffs) {
                        return send(res, 404, { error: { message: "specialist workforce is not composed" } }, correlationId);
                    }
                    return send(res, 200, handoffs, correlationId);
                }
                return send(res, 404, { error: { message: "not found" } }, correlationId);
            }
            case "tasks":
                return send(res, 200, id
                    ? notNull(query.getTask(principal, id))
                    : query.getTasks(principal, parseTaskQuery(params)), correlationId);
            case "workflows":
                return send(res, 200, id
                    ? notNull(query.getWorkflow(principal, id))
                    : query.getWorkflows(principal, parseWorkflowQuery(params)), correlationId);
            case "approvals":
                // GET /api/approvals (page) · GET /api/approvals/:approvalId (detail)
                if (id) {
                    return send(res, 200, notNull(query.getApproval(principal, id)), correlationId);
                }
                return send(res, 200, query.getApprovalPage(principal, {
                    ...statusFilter(params),
                    ...parsePageQuery(params),
                    ...(params.get("projectId")
                        ? { projectId: params.get("projectId") }
                        : {}),
                }), correlationId);
            case "projects":
                if (segs.length === 3 && segs[2] === "graph" && options.graphQuery) {
                    // Validate `since` before any work so a malformed value costs nothing.
                    const since = params.get("since");
                    if (since !== null && since !== "" && !/^\d{1,12}$/.test(since)) {
                        throw new ValidationError("since must be a revision number");
                    }
                    const graph = notNull(await options.graphQuery.getWorkforceGraph(principal, parseGraphQueryParams(id, params)));
                    // Conditional poll: authorisation and projection above ran in full,
                    // so `since` can only ever save bandwidth, never widen access.
                    if (since !== null &&
                        since !== "" &&
                        Number(since) === graph.revision) {
                        const unchanged = {
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
                    return send(res, 200, notNull(await options.graphQuery.getInsights(principal, id)), correlationId);
                }
                // `GET /projects/:projectId/agents` — nested project resource route.
                if (segs.length === 3 && segs[2] === "agents") {
                    return send(res, 200, notNull(await query.getProjectAgents(principal, id)), correlationId);
                }
                // EO-4.7 Execution Control Center (project-scoped, bounded).
                if (segs[2] === "executions" && segs.length === 3) {
                    return send(res, 200, notNull(await query.getExecutionSessionPage(principal, id, {
                        ...(params.get("status")
                            ? { status: params.get("status") }
                            : {}),
                        ...boundedInts(params, ["limit", "offset"]),
                    })), correlationId);
                }
                if (segs[2] === "executions" && segs.length === 4) {
                    const bounds = boundedInts(params, [
                        "timelineLimit",
                        "timelineOffset",
                    ]);
                    return send(res, 200, notNull(await query.getExecutionSessionDetail(principal, id, segs[3], bounds)), correlationId);
                }
                if (segs.length === 3 && segs[2] === "execution-overview") {
                    return send(res, 200, notNull(await query.getExecutionOverview(principal, id)), correlationId);
                }
                if (segs.length === 3 && segs[2] === "verifications") {
                    return send(res, 200, notNull(await query.getProjectVerifications(principal, id)), correlationId);
                }
                if (segs.length === 3 && segs[2] === "releases") {
                    return send(res, 200, notNull(await query.getProjectReleases(principal, id)), correlationId);
                }
                // EO-6.2 AI Cost Center: usage, budget policy, evaluated status.
                if (segs.length === 3 && segs[2] === "cost") {
                    return send(res, 200, notNull(await query.getProjectCostReport(principal, id)), correlationId);
                }
                // EO-6.2 rule-based Auditor findings (never model-assisted).
                if (segs.length === 3 && segs[2] === "audit-findings") {
                    return send(res, 200, notNull(await query.getProjectAuditFindings(principal, id)), correlationId);
                }
                // EO-6.3 governance policy (provider/model allow-list, approval threshold).
                if (segs.length === 3 && segs[2] === "governance-policy") {
                    return send(res, 200, notNull(await query.getProjectGovernancePolicy(principal, id)), correlationId);
                }
                // EO-7 routing decision history / one reconstructable decision.
                if (segs.length === 3 && segs[2] === "routing-decisions") {
                    return send(res, 200, notNull(await query.getProjectRoutingDecisions(principal, id)), correlationId);
                }
                if (segs.length === 4 && segs[2] === "routing-decisions") {
                    return send(res, 200, notNull(await query.getProjectRoutingDecision(principal, id, segs[3])), correlationId);
                }
                // `GET /projects/:projectId/execution-sessions` (EO-4.1, metadata only)
                if (segs.length === 3 && segs[2] === "execution-sessions") {
                    return send(res, 200, notNull(await query.getExecutionSessions(principal, id)), correlationId);
                }
                // `GET /projects/:projectId/execution-plans[/:planId][?version=N]`
                // — planning state only; there is no execution route.
                if (segs[2] === "execution-plans" && segs.length === 3) {
                    return send(res, 200, notNull(await query.getExecutionPlans(principal, id, parsePageQuery(params))), correlationId);
                }
                // `current` is reserved: plan ids are `plan_<uuid>`.
                if (segs[2] === "execution-plans" &&
                    segs.length === 4 &&
                    segs[3] === "current") {
                    const current = await query.getCurrentExecutionPlan(principal, id);
                    // undefined → 404 (unknown/foreign project); null → no plan yet.
                    if (current === undefined)
                        throw new NotFoundError("resource not found");
                    return send(res, 200, { plan: current }, correlationId);
                }
                if (segs[2] === "execution-plans" && segs.length === 4) {
                    return send(res, 200, notNull(await query.getExecutionPlan(principal, id, segs[3], parsePlanVersion(params))), correlationId);
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
            case "environments":
                // GET /api/environments/descriptors[/:id], GET /api/environments/instances[/:id]
                if (segs[1] === "descriptors") {
                    return send(res, 200, segs.length >= 3
                        ? notNull(query.getEnvironmentDescriptor(principal, segs[2]))
                        : query.getEnvironmentDescriptors(principal), correlationId);
                }
                if (segs[1] === "instances") {
                    return send(res, 200, segs.length >= 3
                        ? notNull(query.getEnvironmentInstance(principal, segs[2]))
                        : query.getEnvironmentInstances(principal), correlationId);
                }
                return send(res, 404, { error: { message: "not found" } }, correlationId);
            case "hosts":
                // GET /api/hosts[/:id], GET /api/hosts/:id/capabilities
                if (segs.length === 3 && segs[2] === "capabilities") {
                    return send(res, 200, notNull(query.getHostCapabilitySnapshot(principal, id)), correlationId);
                }
                return send(res, 200, id
                    ? notNull(query.getHost(principal, id))
                    : query.getHosts(principal), correlationId);
            case "execution":
                // GET /api/execution/operations, GET /api/execution/sessions/:sessionId
                if (segs.length === 2 && segs[1] === "environments") {
                    return send(res, 200, query.getExecutionEnvironments(principal), correlationId);
                }
                if (segs.length === 2 && segs[1] === "operations") {
                    return send(res, 200, query.getExecutionOperations(principal), correlationId);
                }
                if (segs.length === 3 && segs[1] === "sessions") {
                    return send(res, 200, notNull(await query.getExecutionSession(principal, segs[2])), correlationId);
                }
                return send(res, 404, { error: { message: "not found" } }, correlationId);
            case "planning":
                // GET /api/planning/technologies — read-only planner catalog.
                if (segs.length === 2 && segs[1] === "technologies") {
                    return send(res, 200, query.getTechnologyCatalog(principal), correlationId);
                }
                return send(res, 404, { error: { message: "not found" } }, correlationId);
            case "operators":
                // GET /api/operators — Users & Access (administrators only).
                if (segs.length !== 1) {
                    return send(res, 404, { error: { message: "not found" } }, correlationId);
                }
                return send(res, 200, notNull(await query.getOperatorAccounts(principal)), correlationId);
            case "audit":
                // GET /api/audit (trail) · GET /api/audit/:eventId (detail)
                if (id) {
                    return send(res, 200, notNull(query.getAuditEvent(principal, id)), correlationId);
                }
                return send(res, 200, query.getAuditEvents(principal, parseAuditQuery(params)), correlationId);
            case "software-factory":
                // GET /api/software-factory, GET /api/software-factory/programs/:programId
                if (segs[1] === "programs" && segs.length === 3) {
                    const projectId = params.get("projectId");
                    if (!projectId || projectId.trim() === "") {
                        return send(res, 400, { error: { message: "projectId is required" } }, correlationId);
                    }
                    return send(res, 200, query.getSoftwareFactoryProgramDetail(principal, projectId, segs[2]), correlationId);
                }
                if (segs.length === 1) {
                    const projectId = params.get("projectId");
                    if (projectId !== null && projectId.trim() === "") {
                        return send(res, 400, { error: { message: "projectId must not be blank" } }, correlationId);
                    }
                    return send(res, 200, query.getSoftwareFactoryOverview(principal, projectId ?? undefined), correlationId);
                }
                return send(res, 404, { error: { message: "not found" } }, correlationId);
            default:
                return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
    }
    async function handleItsm(route, segs, method, req, res, principal, correlationId) {
        if (!options.itsm)
            return send(res, 404, { error: { message: "itsm not found" } }, correlationId);
        try {
            if (segs[1] === "services") {
                if (method === "GET") {
                    return send(res, 200, await options.itsm.listServices(principal.id), correlationId);
                }
                else if (method === "POST") {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 200, await options.itsm.createService(body), correlationId);
                }
            }
            if (segs[1] === "incidents") {
                if (method === "GET") {
                    const serviceId = new URL(req.url ?? "/", "http://localhost").searchParams.get("serviceId");
                    return send(res, 200, await options.itsm.listIncidents(principal.id, serviceId || undefined), correlationId);
                }
                else if (method === "POST") {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 200, await options.itsm.createIncident(body), correlationId);
                }
            }
            if (segs[1] === "changes") {
                if (method === "GET") {
                    return send(res, 200, await options.itsm.listChangeRequests(principal.id), correlationId);
                }
                else if (method === "POST") {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 200, await options.itsm.createChangeRequest(body), correlationId);
                }
            }
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    async function handleOperations(route, segs, method, req, res, principal, correlationId) {
        if (!options.ops)
            return send(res, 404, { error: { message: "ops not available" } }, correlationId);
        try {
            if (segs[1] === "health") {
                if (method === "GET") {
                    return send(res, 200, await options.ops.getGlobalHealth(), correlationId);
                }
                else if (method === "POST") {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 200, await options.ops.reportHealth(principal, body), correlationId);
                }
            }
            if (segs[1] === "alerts") {
                if (method === "GET") {
                    return send(res, 200, await options.ops.listAlerts(), correlationId);
                }
            }
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    async function handleGrc(route, segs, method, req, res, principal, correlationId) {
        if (!options.grc)
            return send(res, 404, { error: { message: "grc not available" } }, correlationId);
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
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    async function handleAIGovernance(route, segs, method, req, res, principal, correlationId) {
        if (!options.aiGov)
            return send(res, 404, { error: { message: "ai governance not available" } }, correlationId);
        try {
            if (segs[1] === "models" && method === "GET") {
                return send(res, 200, await options.aiGov.listModels(), correlationId);
            }
            if (segs[1] === "use-cases" && method === "GET") {
                // Simple global fetch for prototype
                return send(res, 200, await options.aiGov.listUseCases("global"), correlationId);
            }
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    async function handleDataGovernance(route, segs, method, req, res, principal, correlationId) {
        if (!options.dataGov)
            return send(res, 404, { error: { message: "data governance not available" } }, correlationId);
        try {
            if (segs[1] === "assets" && method === "GET") {
                return send(res, 200, await options.dataGov.listAssets(), correlationId);
            }
            if (segs[1] === "retention-policies" && method === "GET") {
                return send(res, 200, await options.dataGov.listRetentionPolicies(), correlationId);
            }
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    function requireCapability(principal, capability) {
        const allowed = ROLE_CAPABILITIES[principal.role]?.includes(capability);
        if (!allowed) {
            throw new PermissionDeniedError(`Operator '${principal.id}' lacks required capability '${capability}'`);
        }
    }
    async function handleSecurity(route, segs, method, req, res, principal, correlationId) {
        if (!options.security && !options.securityCenter) {
            return send(res, 404, { error: { message: "security not available" } }, correlationId);
        }
        try {
            const url = new URL(req.url ?? "/", "http://localhost");
            // ---- Security Center API Endpoints ----
            if (options.securityCenter) {
                if (segs[1] === "summary" && method === "GET") {
                    requireCapability(principal, "view_security");
                    const projectId = url.searchParams.get("projectId") || undefined;
                    return send(res, 200, await options.securityCenter.getSummary(principal, projectId), correlationId);
                }
                if (segs[1] === "domains" && method === "GET") {
                    requireCapability(principal, "view_security");
                    const summary = await options.securityCenter.getSummary(principal);
                    return send(res, 200, summary.domains, correlationId);
                }
                if (segs[1] === "recommendations" && method === "GET") {
                    requireCapability(principal, "view_security");
                    return send(res, 200, await options.securityCenter.getRecommendations(), correlationId);
                }
                if (segs[1] === "alerts" && method === "GET" && segs.length === 2) {
                    requireCapability(principal, "view_security_events");
                    const severity = url.searchParams.get("severity") || undefined;
                    const status = url.searchParams.get("status") || undefined;
                    const domain = url.searchParams.get("domain") || undefined;
                    const projectId = url.searchParams.get("projectId") || undefined;
                    return send(res, 200, options.securityCenter.listAlerts({ severity: severity, status: status, domain: domain }, principal, projectId), correlationId);
                }
                if (segs[1] === "alerts" && method === "GET" && segs.length === 3) {
                    requireCapability(principal, "view_security_events");
                    const alert = options.securityCenter.getAlert(segs[2], principal);
                    if (!alert)
                        throw new NotFoundError("alert not found");
                    return send(res, 200, alert, correlationId);
                }
                if (segs[1] === "alerts" && segs[3] === "acknowledge" && method === "POST") {
                    requireCapability(principal, "manage_security_incidents");
                    return send(res, 200, await options.securityCenter.acknowledgeAlert(segs[2], principal.id), correlationId);
                }
                if (segs[1] === "alerts" && segs[3] === "dismiss" && method === "POST") {
                    requireCapability(principal, "manage_security_incidents");
                    const body = (await readJsonBody(req, maxBody));
                    return send(res, 200, await options.securityCenter.dismissAlert(segs[2], principal.id, String(body.reason || "")), correlationId);
                }
                if (segs[1] === "incidents" && method === "GET" && segs.length === 2) {
                    requireCapability(principal, "view_security");
                    const severity = url.searchParams.get("severity") || undefined;
                    const status = url.searchParams.get("status") || undefined;
                    const domain = url.searchParams.get("domain") || undefined;
                    const projectId = url.searchParams.get("projectId") || undefined;
                    return send(res, 200, options.securityCenter.listIncidents({ severity: severity, status: status, domain: domain }, principal, projectId), correlationId);
                }
                if (segs[1] === "incidents" && method === "GET" && segs.length === 3) {
                    requireCapability(principal, "view_security");
                    const incident = options.securityCenter.getIncident(segs[2], principal);
                    if (!incident)
                        throw new NotFoundError("incident not found");
                    return send(res, 200, incident, correlationId);
                }
                if (segs[1] === "incidents" && segs[3] === "assign" && method === "POST") {
                    requireCapability(principal, "manage_security_incidents");
                    const body = (await readJsonBody(req, maxBody));
                    return send(res, 200, await options.securityCenter.assignIncident(segs[2], String(body.owner || ""), principal.id), correlationId);
                }
                if (segs[1] === "incidents" && segs[3] === "status" && method === "POST") {
                    requireCapability(principal, "manage_security_incidents");
                    const body = (await readJsonBody(req, maxBody));
                    return send(res, 200, await options.securityCenter.updateIncidentStatus(segs[2], body.status, principal.id, body.note ? String(body.note) : undefined), correlationId);
                }
                if (segs[1] === "incidents" && segs[3] === "resolve" && method === "POST") {
                    requireCapability(principal, "manage_security_incidents");
                    const body = (await readJsonBody(req, maxBody));
                    return send(res, 200, await options.securityCenter.resolveIncident(segs[2], principal.id, String(body.summary || ""), body.rootCause ? String(body.rootCause) : undefined), correlationId);
                }
                if (segs[1] === "incidents" && segs[3] === "reopen" && method === "POST") {
                    requireCapability(principal, "manage_security_incidents");
                    const body = (await readJsonBody(req, maxBody));
                    return send(res, 200, await options.securityCenter.reopenIncident(segs[2], principal.id, String(body.reason || "")), correlationId);
                }
                if (segs[1] === "incidents" && segs[3] === "notes" && method === "POST") {
                    requireCapability(principal, "manage_security_incidents");
                    const body = (await readJsonBody(req, maxBody));
                    return send(res, 200, await options.securityCenter.addIncidentNote(segs[2], principal.id, String(body.note || "")), correlationId);
                }
            }
            // ---- Legacy Security Endpoints ----
            if (options.security) {
                if (segs[1] === "events" && method === "GET") {
                    requireCapability(principal, "view_security_events");
                    return send(res, 200, await options.security.listEvents(), correlationId);
                }
                if (segs[1] === "policies" && method === "GET") {
                    requireCapability(principal, "view_security");
                    return send(res, 200, await options.security.listPolicies(), correlationId);
                }
            }
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    async function handleAudit(route, segs, method, req, res, principal, correlationId) {
        if (!options.audit)
            return send(res, 404, { error: { message: "audit not available" } }, correlationId);
        try {
            if (segs[1] === "logs" && method === "GET") {
                return send(res, 200, await options.audit.listAuditLogs(), correlationId);
            }
            if (segs[1] === "findings" && method === "GET") {
                return send(res, 200, await options.audit.listFindings(), correlationId);
            }
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    async function handlePortfolio(route, segs, method, req, res, principal, correlationId) {
        if (!options.portfolio)
            return send(res, 404, { error: { message: "portfolio not available" } }, correlationId);
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
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    async function handleProduct(route, segs, method, req, res, principal, correlationId) {
        if (!options.product)
            return send(res, 404, { error: { message: "product not available" } }, correlationId);
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
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    /**
     * Knowledge module (Phase 2 — Control Plane §17).
     *
     * Knowledge module (Phase 2 — Control Plane §17 & Layer 14 Knowledge Learning).
     *
     * Namespaced under /knowledge-items (rather than /knowledge) because
     * /knowledge/* is owned by the separate Knowledge, Memory & Context
     * Intelligence center (see `options.knowledgeMemory` / `case "knowledge"`
     * in `handleGet`, and the `knowledge_*` command family).
     *
     *   GET  /api/knowledge-items?projectId=&type=&search=
     *   GET  /api/knowledge-items/:knowledgeId
     *   POST /api/knowledge-items              (create; admin only)
     *   PUT  /api/knowledge-items/:knowledgeId (update; admin only)
     *   GET  /api/knowledge-items/adrs
     *   POST /api/knowledge-items/adrs
     *   PUT  /api/knowledge-items/adrs/:adrId/status
     *   GET  /api/knowledge-items/lessons
     *   POST /api/knowledge-items/lessons
     *   GET  /api/knowledge-items/conflicts
     *   POST /api/knowledge-items/conflicts/:conflictId/resolve
     *   GET  /api/knowledge-items/quality
     *   POST /api/knowledge-items/retrieve
     *
     * Authorization and validation live in the service; the API only maps errors.
     */
    async function handleKnowledge(req, res, segs, method, params, principal, correlationId) {
        const knowledge = options.knowledge;
        if (!knowledge) {
            return send(res, 404, { error: { message: "knowledge not available" } }, correlationId);
        }
        try {
            const sub = segs[1];
            // ADR Sub-resource
            if (sub === "adrs") {
                if (method === "GET" && segs.length === 2) {
                    const items = knowledge.list(principal, {
                        ...(params.get("projectId") ? { projectId: params.get("projectId") } : {}),
                        type: "architecture_decision",
                    });
                    return send(res, 200, { items, total: items.length }, correlationId);
                }
                if (method === "POST" && segs.length === 2) {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 201, knowledge.proposeADR(principal, body), correlationId);
                }
                if (method === "PUT" && segs.length === 4 && segs[3] === "status") {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 200, knowledge.updateADRStatus(principal, segs[2], body.status, body.notes), correlationId);
                }
            }
            // Lessons Learned Sub-resource
            if (sub === "lessons") {
                if (method === "GET" && segs.length === 2) {
                    const items = knowledge.list(principal, {
                        ...(params.get("projectId") ? { projectId: params.get("projectId") } : {}),
                        type: "lesson",
                    });
                    return send(res, 200, { items, total: items.length }, correlationId);
                }
                if (method === "POST" && segs.length === 2) {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 201, knowledge.recordLesson(principal, body), correlationId);
                }
            }
            // Conflicts Sub-resource
            if (sub === "conflicts") {
                if (method === "GET" && segs.length === 2) {
                    const conflicts = knowledge.getConflicts(principal, params.get("projectId") ?? undefined);
                    return send(res, 200, { conflicts, total: conflicts.length }, correlationId);
                }
                if (method === "POST" && segs.length === 4 && segs[3] === "resolve") {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 200, knowledge.resolveConflict(principal, segs[2], body.winnerId, body.resolutionNotes), correlationId);
                }
            }
            // Quality Audit Report Sub-resource
            if (sub === "quality" && method === "GET" && segs.length === 2) {
                const report = knowledge.getQualityReport(principal, params.get("projectId") ?? undefined);
                return send(res, 200, report, correlationId);
            }
            // Scoped Context Retrieval Sub-resource
            if (sub === "retrieve" && method === "POST" && segs.length === 2) {
                const body = await readJsonBody(req, maxBody);
                const results = knowledge.retrieveContextKnowledge(principal, body);
                return send(res, 200, { items: results, total: results.length }, correlationId);
            }
            // Standard Knowledge CRUD
            const id = segs[1];
            if (method === "GET" && segs.length === 1) {
                const type = params.get("type");
                const items = knowledge.list(principal, {
                    ...(params.get("projectId")
                        ? { projectId: params.get("projectId") }
                        : {}),
                    ...(type ? { type: type } : {}),
                    ...(params.get("search")
                        ? { search: params.get("search") }
                        : {}),
                });
                return send(res, 200, { items, total: items.length }, correlationId);
            }
            if (method === "GET" && id && segs.length === 2) {
                return send(res, 200, notNull(knowledge.get(principal, id)), correlationId);
            }
            if (method === "POST" && segs.length === 1) {
                const body = await readJsonBody(req, maxBody);
                return send(res, 201, knowledge.create(principal, body), correlationId);
            }
            if (method === "PUT" && id && segs.length === 2) {
                const body = await readJsonBody(req, maxBody);
                return send(res, 200, knowledge.update(principal, id, body), correlationId);
            }
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    /**
     * Layer 15 — Simulation & Decision Intelligence API
     *
     *   POST /api/simulation/run
     *   GET  /api/simulation/snapshots
     *   GET  /api/simulation/snapshots/:id
     *   POST /api/simulation/snapshots/:id/decide
     */
    async function handleSimulation(req, res, segs, method, params, principal, correlationId) {
        const simulation = options.simulation;
        if (!simulation) {
            return send(res, 404, { error: { message: "simulation not available" } }, correlationId);
        }
        try {
            const sub = segs[1];
            if (sub === "run" && method === "POST" && segs.length === 2) {
                const body = await readJsonBody(req, maxBody);
                const snapshot = simulation.runSimulation(principal, body);
                return send(res, 201, snapshot, correlationId);
            }
            if (sub === "snapshots") {
                if (method === "GET" && segs.length === 2) {
                    const snapshots = simulation.listSnapshots(principal, params.get("projectId") ?? undefined);
                    return send(res, 200, { snapshots, total: snapshots.length }, correlationId);
                }
                if (method === "GET" && segs.length === 3) {
                    const snapshot = simulation.getSnapshot(principal, segs[2]);
                    return send(res, 200, notNull(snapshot), correlationId);
                }
                if (method === "POST" && segs.length === 4 && segs[3] === "decide") {
                    const body = await readJsonBody(req, maxBody);
                    const decided = simulation.decideOption(principal, segs[2], body.optionId, body.notes);
                    return send(res, 200, decided, correlationId);
                }
            }
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    /**
     * Layer 16 — Trust, Governance & Human Oversight Center API
     *
     *   GET  /api/trust/overview
     *   GET  /api/trust/entities
     *   GET  /api/trust/entities/:id
     *   POST /api/trust/entities
     *   POST /api/trust/evaluate
     *   GET  /api/trust/approvals
     *   POST /api/trust/approvals
     *   POST /api/trust/approvals/:id/decide
     *   GET  /api/trust/emergency
     *   POST /api/trust/emergency/lock
     *   POST /api/trust/emergency/release
     *   GET  /api/trust/events
     */
    async function handleTrust(req, res, segs, method, params, principal, correlationId) {
        const trust = options.trust;
        if (!trust) {
            return send(res, 404, { error: { message: "trust governance not available" } }, correlationId);
        }
        try {
            const sub = segs[1];
            // Trust Center Overview
            if (sub === "overview" && method === "GET" && segs.length === 2) {
                const summary = trust.getTrustCenterSummary(principal, params.get("projectId") ?? undefined);
                return send(res, 200, summary, correlationId);
            }
            // Trust Entities
            if (sub === "entities") {
                if (method === "GET" && segs.length === 2) {
                    const entities = trust.listTrustEntities(principal, params.get("type") ?? undefined);
                    return send(res, 200, { entities, total: entities.length }, correlationId);
                }
                if (method === "GET" && segs.length === 3) {
                    return send(res, 200, notNull(trust.getTrustEntity(principal, segs[2])), correlationId);
                }
                if (method === "POST" && segs.length === 2) {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 200, trust.upsertTrustEntity(principal, body), correlationId);
                }
            }
            // Policy Evaluation & Governance Gateway
            if (sub === "evaluate" && method === "POST" && segs.length === 2) {
                const body = await readJsonBody(req, maxBody);
                return send(res, 200, trust.evaluateAndGovernAction(principal, body), correlationId);
            }
            // Unified Approvals Center
            if (sub === "approvals") {
                if (method === "GET" && segs.length === 2) {
                    const approvals = trust.listApprovals(principal, {
                        projectId: params.get("projectId") ?? undefined,
                        status: params.get("status") ?? undefined,
                    });
                    return send(res, 200, { approvals, total: approvals.length }, correlationId);
                }
                if (method === "POST" && segs.length === 2) {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 201, trust.createApprovalRequest(principal, body), correlationId);
                }
                if (method === "POST" && segs.length === 4 && segs[3] === "decide") {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 200, trust.decideApproval(principal, segs[2], body.decision, body.notes, body.modifiedPayload), correlationId);
                }
            }
            // Emergency Controls
            if (sub === "emergency") {
                if (method === "GET" && segs.length === 2) {
                    return send(res, 200, trust.getEmergencyControlState(principal), correlationId);
                }
                if (method === "POST" && segs.length === 3 && segs[2] === "lock") {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 200, trust.executeEmergencyControl(principal, body), correlationId);
                }
                if (method === "POST" && segs.length === 3 && segs[2] === "release") {
                    const body = await readJsonBody(req, maxBody);
                    return send(res, 200, trust.releaseEmergencyControl(principal, body.lockId), correlationId);
                }
            }
            // Immutable Trust Audit Events
            if (sub === "events" && method === "GET" && segs.length === 2) {
                const events = trust.listTrustEvents(principal, {
                    projectId: params.get("projectId") ?? undefined,
                    limit: Number(params.get("limit")) || 50,
                });
                return send(res, 200, { events, total: events.length }, correlationId);
            }
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        catch (e) {
            return send(res, statusForError(e), { error: { message: errorMessage(e) } }, correlationId);
        }
    }
    /**
     * `GET /me/profile`, `PUT /me/profile/photo` {dataUrl},
     * `DELETE /me/profile/photo` — always the principal's own profile.
     */
    async function handleProfile(req, res, route, method, principal, correlationId) {
        const profile = options.profile;
        if (!profile) {
            return send(res, 404, { error: { message: "not found" } }, correlationId);
        }
        if (route === "/me/profile" && method === "GET") {
            return send(res, 200, await profile.myProfile(principal), correlationId);
        }
        if (route === "/me/profile/photo" && method === "PUT") {
            const body = await readJsonBody(req, maxBody);
            return send(res, 200, await profile.setPhoto(principal, body.dataUrl, correlationId), correlationId);
        }
        if (route === "/me/profile/photo" && method === "DELETE") {
            return send(res, 200, await profile.removePhoto(principal, correlationId), correlationId);
        }
        return send(res, 405, { error: { message: "method not allowed" } }, correlationId);
    }
    async function handleCommand(req, res, name, principal, correlationId) {
        const layered = [
            ["extension_", options.extensionCenter],
            ["business_", options.businessCenter],
            ["portfolio_", options.portfolioCenter],
            ["autonomy_", options.operationsCenter],
            ["analytics_", options.analyticsCenter],
        ];
        for (const [prefix, service] of layered) {
            if (!name.startsWith(prefix) || !service)
                continue;
            await options.refreshData?.();
            let payload;
            try {
                payload = await readJsonBody(req, maxBody);
            }
            catch (error) {
                return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
            }
            const outcome = await service.execute(name, principal, payload, {
                correlationId,
            });
            return send(res, outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200, outcome, correlationId);
        }
        if (name.startsWith("integration_") && options.integrationCenter) {
            let payload;
            try {
                payload = await readJsonBody(req, maxBody);
            }
            catch (error) {
                return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
            }
            const outcome = await options.integrationCenter.execute(name, principal, payload, { correlationId });
            return send(res, outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200, outcome, correlationId);
        }
        if (name.startsWith("security_") && options.trustCenter) {
            let payload;
            try {
                payload = await readJsonBody(req, maxBody);
            }
            catch (error) {
                return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
            }
            const outcome = await options.trustCenter.execute(name, principal, payload, { correlationId });
            return send(res, outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200, outcome, correlationId);
        }
        if (name.startsWith("knowledge_") && options.knowledgeMemory) {
            let payload;
            try {
                payload = await readJsonBody(req, maxBody);
            }
            catch (error) {
                return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
            }
            const outcome = await options.knowledgeMemory.execute(name, principal, payload, { correlationId });
            return send(res, outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200, outcome, correlationId);
        }
        if (name.startsWith("runtime_") && options.runtime) {
            const runtime = options.runtime;
            const method = Object.hasOwn(RUNTIME_METHODS, name)
                ? RUNTIME_METHODS[name]
                : undefined;
            if (!method) {
                return send(res, 404, { error: { message: `unknown command: ${name}` } }, correlationId);
            }
            let payload;
            try {
                payload = await readJsonBody(req, maxBody);
            }
            catch (error) {
                return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
            }
            const fn = runtime[method];
            const outcome = fn.call(runtime, principal, payload, { correlationId });
            return send(res, outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200, outcome, correlationId);
        }
        if (name.startsWith("orchestration_") && options.orchestration) {
            const orchestration = options.orchestration;
            const method = Object.hasOwn(ORCHESTRATION_METHODS, name)
                ? ORCHESTRATION_METHODS[name]
                : undefined;
            if (!method) {
                return send(res, 404, { error: { message: `unknown command: ${name}` } }, correlationId);
            }
            let payload;
            try {
                payload = await readJsonBody(req, maxBody);
            }
            catch (error) {
                return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
            }
            const fn = orchestration[method];
            const outcome = await fn.call(orchestration, principal, payload, {
                correlationId,
            });
            return send(res, outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200, outcome, correlationId);
        }
        if (name.startsWith("prompt_") && options.promptIntelligence) {
            const promptIntelligence = options.promptIntelligence;
            const method = Object.hasOwn(PROMPT_METHODS, name)
                ? PROMPT_METHODS[name]
                : undefined;
            if (!method) {
                return send(res, 404, { error: { message: `unknown command: ${name}` } }, correlationId);
            }
            let payload;
            try {
                payload = await readJsonBody(req, maxBody);
            }
            catch (error) {
                return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
            }
            const fn = promptIntelligence[method];
            const outcome = await fn.call(promptIntelligence, principal, payload, {
                correlationId,
            });
            return send(res, outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200, outcome, correlationId);
        }
        if (name.startsWith("onboarding_") && options.onboarding) {
            const onboarding = options.onboarding;
            const method = Object.hasOwn(ONBOARDING_METHODS, name)
                ? ONBOARDING_METHODS[name]
                : undefined;
            if (!method) {
                return send(res, 404, { error: { message: `unknown command: ${name}` } }, correlationId);
            }
            let payload;
            try {
                payload = await readJsonBody(req, maxBody);
            }
            catch (error) {
                return send(res, 400, { error: { message: errorMessage(error) } }, correlationId);
            }
            const fn = onboarding[method];
            const outcome = await fn.call(onboarding, principal, payload, {
                correlationId,
            });
            return send(res, outcome.errorKind ? ERROR_KIND_STATUS[outcome.errorKind] : 200, outcome, correlationId);
        }
        // Own properties only: inherited names ("constructor", "__proto__", "toString") are not commands.
        const methodName = Object.hasOwn(COMMAND_METHODS, name)
            ? COMMAND_METHODS[name]
            : undefined;
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
/** The exact bytes of the request body: a webhook signature is computed over them, never over re-serialised JSON. */
async function readRawBody(req, maxBytes) {
    const raw = req.rawBody;
    if (raw !== undefined) {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        if (text.length > maxBytes)
            throw new ValidationError("request body too large");
        return text;
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
    return Buffer.concat(chunks).toString("utf8");
}
async function readJsonBody(req, maxBytes) {
    // Security Foundation V1 Step 5: Content-Type enforcement
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
        throw new ValidationError("Expected Content-Type: application/json");
    }
    // Firebase HTTPS Functions uses Express and may have parsed the JSON body and may have parsed the JSON body
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
/** Non-negative integers from the query string (invalid → ValidationError). */
function boundedInts(params, keys) {
    const out = {};
    for (const key of keys) {
        const raw = params.get(key);
        if (raw === null)
            continue;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 0 || value > 100_000) {
            throw new ValidationError(`${key} must be a non-negative integer`);
        }
        out[key] = value;
    }
    return out;
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
function parsePageQuery(params) {
    const q = {};
    const cursor = params.get("cursor");
    if (cursor !== null && cursor !== "")
        q.cursor = cursor;
    const limit = Number(params.get("limit"));
    if (Number.isFinite(limit) && limit > 0)
        q.limit = limit;
    const planId = params.get("planId");
    if (planId !== null && planId !== "")
        q.planId = planId;
    return q;
}
/** `?version=N` — a positive integer, otherwise the current version. */
function parsePlanVersion(params) {
    const raw = params.get("version");
    if (raw === null || raw === "")
        return undefined;
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 1) {
        throw new ValidationError("version must be a positive integer");
    }
    return version;
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
