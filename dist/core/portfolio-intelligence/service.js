/**
 * Portfolio Intelligence service. Reads real platform data through injected ports and answers
 * portfolio questions; stores only the owner's own project attributes, dependencies and declared
 * resource claims. Every read takes an `accessible(projectId)` filter so a principal never sees a
 * project they cannot access; relationships need BOTH endpoints to be accessible.
 */
import { randomBytes } from "node:crypto";
import { DEPENDENCY_KINDS_PORTFOLIO, PORTFOLIO_PRIORITIES, PORTFOLIO_RESOURCE_KINDS, } from "../../contracts/portfolio-intelligence.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { applyDependencyImpact, computeProjectHealth, tasksOf, } from "./health.js";
export class PortfolioError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "PortfolioError";
    }
}
const PRIORITY_POINTS = {
    LOW: 5,
    NORMAL: 15,
    HIGH: 30,
    CRITICAL: 45,
};
const HEALTH_RISK = {
    BLOCKED: 15,
    CRITICAL: 20,
    AT_RISK: 10,
    UNKNOWN: 0,
    HEALTHY: 0,
};
const NON_TERMINAL = new Set(["QUEUED", "RUNNING", "RETRYING", "READY"]);
const clampInt = (v, name, lo, hi, dflt) => {
    if (v === undefined || v === null)
        return dflt;
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi)
        throw new PortfolioError("invalid_request", `${name} must be a whole number from ${lo} to ${hi}`);
    return v;
};
const textList = (v, max) => Array.isArray(v)
    ? v
        .filter((x) => typeof x === "string" && x.trim() !== "")
        .map((x) => x.trim().slice(0, 200))
        .slice(0, max)
    : [];
const optText = (v, max) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
export class PortfolioIntelligence {
    ports;
    profiles;
    deps;
    claims;
    constructor(repos, ports) {
        this.ports = ports;
        this.profiles = new SyncCache(repos.profiles);
        this.deps = new SyncCache(repos.dependencies);
        this.claims = new SyncCache(repos.claims);
    }
    led(op, actor, detail) {
        this.ports.ledger.record(`portfolio.${op}`, {
            actor,
            result: "OK",
            detail,
        });
    }
    /* ------------------------------ profile ------------------------------ */
    facts(projectId) {
        const f = this.ports.projects().find((p) => p.projectId === projectId);
        if (!f)
            throw new PortfolioError("not_found", "project not found");
        return f;
    }
    profile(projectId) {
        return (this.profiles.findById(projectId) ?? {
            id: projectId,
            projectId,
            priority: "NORMAL",
            strategicImportance: 3,
            urgency: 3,
            declaredRisk: 2,
            objectives: [],
            stack: [],
            archived: false,
            updatedAt: this.ports.clock(),
            updatedBy: "default",
        });
    }
    setProfile(projectId, input, by) {
        this.facts(projectId);
        const cur = this.profile(projectId);
        const priority = input["priority"] === undefined ? cur.priority : input["priority"];
        if (!PORTFOLIO_PRIORITIES.includes(priority))
            throw new PortfolioError("invalid_request", `priority must be one of ${PORTFOLIO_PRIORITIES.join(", ")}`);
        const deploymentTarget = input["deploymentTarget"] !== undefined
            ? optText(input["deploymentTarget"], 120)
            : cur.deploymentTarget;
        const firebaseProject = input["firebaseProject"] !== undefined
            ? optText(input["firebaseProject"], 60)
            : cur.firebaseProject;
        const environment = input["environment"] !== undefined
            ? optText(input["environment"], 30)
            : cur.environment;
        const next = {
            id: projectId,
            projectId,
            priority: priority,
            strategicImportance: clampInt(input["strategicImportance"], "strategicImportance", 1, 5, cur.strategicImportance),
            urgency: clampInt(input["urgency"], "urgency", 1, 5, cur.urgency),
            declaredRisk: clampInt(input["declaredRisk"], "declaredRisk", 1, 5, cur.declaredRisk),
            objectives: input["objectives"] !== undefined
                ? textList(input["objectives"], 10)
                : cur.objectives,
            stack: input["stack"] !== undefined ? textList(input["stack"], 15) : cur.stack,
            ...(deploymentTarget ? { deploymentTarget } : {}),
            ...(firebaseProject ? { firebaseProject } : {}),
            ...(environment ? { environment } : {}),
            archived: cur.archived,
            updatedAt: this.ports.clock(),
            updatedBy: by,
        };
        this.profiles.upsert(next);
        this.led("profile_set", by, { projectId, priority: next.priority });
        return next;
    }
    /** Archiving hides a project from the portfolio; it deletes nothing. */
    setArchived(projectId, archived, by) {
        this.facts(projectId);
        const next = {
            ...this.profile(projectId),
            archived,
            updatedAt: this.ports.clock(),
            updatedBy: by,
        };
        this.profiles.upsert(next);
        this.led(archived ? "project_archived" : "project_restored", by, {
            projectId,
        });
        return next;
    }
    /* ---------------------------- dependencies ---------------------------- */
    listDependencies(accessible) {
        return this.deps
            .list()
            .filter((d) => accessible(d.from) && accessible(d.to));
    }
    addDependency(input, by, accessible) {
        const from = typeof input["from"] === "string" ? input["from"] : "";
        const to = typeof input["to"] === "string" ? input["to"] : "";
        if (!from || !to || from === to)
            throw new PortfolioError("invalid_request", "choose two different projects");
        // A relationship spans two projects: the caller needs access to both, and both must exist.
        if (!accessible(from) || !accessible(to))
            throw new PortfolioError("not_found", "project not found");
        this.facts(from);
        this.facts(to);
        const kind = input["kind"] ?? "DEPENDS_ON";
        if (!DEPENDENCY_KINDS_PORTFOLIO.includes(kind))
            throw new PortfolioError("invalid_request", `kind must be one of ${DEPENDENCY_KINDS_PORTFOLIO.join(", ")}`);
        if (this.deps
            .list()
            .some((d) => d.from === from && d.to === to && d.kind === kind))
            throw new PortfolioError("conflict", "this relationship already exists");
        if (this.reaches(to, from))
            throw new PortfolioError("invalid_state", `this would create a dependency cycle: ${to} already depends on ${from}`);
        const note = optText(input["note"], 300);
        const dep = {
            id: `dep-${randomBytes(4).toString("hex")}`,
            from,
            to,
            kind: kind,
            weight: clampInt(input["weight"], "weight", 1, 5, 3),
            ...(note ? { note } : {}),
            createdAt: this.ports.clock(),
            createdBy: by,
        };
        this.deps.upsert(dep);
        this.led("dependency_added", by, { from, to, kind: dep.kind });
        return dep;
    }
    removeDependency(dependencyId, by, accessible) {
        const d = this.deps.findById(dependencyId);
        if (!d || !accessible(d.from) || !accessible(d.to))
            throw new PortfolioError("not_found", "dependency not found");
        this.deps.delete(dependencyId);
        this.led("dependency_removed", by, { from: d.from, to: d.to });
    }
    /** Is `target` reachable from `start` following from→to edges? */
    reaches(start, target) {
        const seen = new Set();
        const stack = [start];
        while (stack.length) {
            const cur = stack.pop();
            if (cur === target)
                return true;
            if (seen.has(cur))
                continue;
            seen.add(cur);
            for (const d of this.deps.list())
                if (d.from === cur)
                    stack.push(d.to);
        }
        return false;
    }
    /* ------------------------------- resources ------------------------------- */
    listClaims(accessible) {
        return this.claims.list().filter((c) => accessible(c.projectId));
    }
    claim(input, by, accessible) {
        const projectId = typeof input["projectId"] === "string" ? input["projectId"] : "";
        if (!projectId || !accessible(projectId))
            throw new PortfolioError("not_found", "project not found");
        this.facts(projectId);
        if (!PORTFOLIO_RESOURCE_KINDS.includes(input["kind"]))
            throw new PortfolioError("invalid_request", `kind must be one of ${PORTFOLIO_RESOURCE_KINDS.join(", ")}`);
        const resourceId = optText(input["resourceId"], 120);
        if (!resourceId)
            throw new PortfolioError("invalid_request", "resourceId is required");
        if (this.claims
            .list()
            .some((c) => c.projectId === projectId &&
            c.kind === input["kind"] &&
            c.resourceId === resourceId))
            throw new PortfolioError("conflict", "this project already claims that resource");
        const note = optText(input["note"], 300);
        const c = {
            id: `claim-${randomBytes(4).toString("hex")}`,
            projectId,
            kind: input["kind"],
            resourceId,
            exclusive: input["exclusive"] === true,
            ...(note ? { note } : {}),
            createdAt: this.ports.clock(),
            createdBy: by,
        };
        this.claims.upsert(c);
        this.led("resource_claimed", by, { projectId, kind: c.kind, resourceId });
        return c;
    }
    release(claimId, by, accessible) {
        const c = this.claims.findById(claimId);
        if (!c || !accessible(c.projectId))
            throw new PortfolioError("not_found", "claim not found");
        this.claims.delete(claimId);
        this.led("resource_released", by, {
            projectId: c.projectId,
            resourceId: c.resourceId,
        });
    }
    conflicts(accessible) {
        const out = [];
        // declared
        const byRes = new Map();
        for (const c of this.claims.list()) {
            if (!accessible(c.projectId))
                continue;
            const k = `${c.kind}:${c.resourceId}`;
            byRes.set(k, [...(byRes.get(k) ?? []), c]);
        }
        for (const [, list] of byRes) {
            const projects = [...new Set(list.map((c) => c.projectId))];
            if (projects.length < 2)
                continue;
            const exclusive = list.some((c) => c.exclusive);
            out.push({
                kind: list[0].kind,
                resourceId: list[0].resourceId,
                exclusive,
                projects,
                source: "declared",
                severity: exclusive ? "CONFLICT" : "INFO",
                explanation: exclusive
                    ? `${projects.join(" and ")} both claim ${list[0].kind.toLowerCase()} "${list[0].resourceId}" and at least one claim is exclusive`
                    : `${projects.join(" and ")} share ${list[0].kind.toLowerCase()} "${list[0].resourceId}"`,
            });
        }
        // observed: the same agent, or the same exclusive lock, in flight for two projects at once
        const agentUse = new Map();
        const lockUse = new Map();
        for (const run of this.ports.runs()) {
            if (!accessible(run.projectId) || run.cancelled)
                continue;
            for (const t of run.tasks) {
                if (!NON_TERMINAL.has(t.status))
                    continue;
                if (t.assignedAgent)
                    agentUse.set(t.assignedAgent.agentId, (agentUse.get(t.assignedAgent.agentId) ?? new Set()).add(run.projectId));
                for (const r of t.resources)
                    lockUse.set(r, (lockUse.get(r) ?? new Set()).add(run.projectId));
            }
        }
        for (const [agent, ps] of agentUse)
            if (ps.size > 1)
                out.push({
                    kind: "AGENT",
                    resourceId: agent,
                    exclusive: false,
                    projects: [...ps],
                    source: "observed",
                    severity: "WARNING",
                    explanation: `agent ${agent} has work in flight for ${[...ps].join(" and ")} at the same time`,
                });
        for (const [lock, ps] of lockUse)
            if (ps.size > 1)
                out.push({
                    kind: "LOCK",
                    resourceId: lock,
                    exclusive: true,
                    projects: [...ps],
                    source: "observed",
                    severity: "CONFLICT",
                    explanation: `${[...ps].join(" and ")} both hold work on exclusive resource "${lock}"`,
                });
        return out;
    }
    /* -------------------------------- health -------------------------------- */
    healthMap(accessible) {
        const facts = this.ports.projects().filter((p) => accessible(p.projectId));
        const runs = this.ports.runs();
        const alerts = this.ports.alerts();
        const now = this.ports.clock();
        const base = new Map();
        for (const f of facts) {
            const budget = this.ports.budgetFor?.(f.projectId);
            const overdue = this.ports.overdueObjectives?.(f.projectId);
            base.set(f.projectId, computeProjectHealth({
                projectId: f.projectId,
                runs,
                deriveRunStatus: (r) => this.ports.deriveRunStatus(r),
                alerts,
                ...(budget ? { budget } : {}),
                ...(overdue !== undefined ? { overdueObjectives: overdue } : {}),
                now,
            }));
        }
        const out = new Map();
        for (const [id, h] of base)
            out.set(id, applyDependencyImpact(h, this.deps
                .list()
                .filter((d) => d.from === id)
                .map((d) => ({ to: d.to, weight: d.weight })), base));
        return out;
    }
    health(projectId, accessible) {
        if (!accessible(projectId))
            throw new PortfolioError("not_found", "project not found");
        this.facts(projectId);
        return this.healthMap(accessible).get(projectId);
    }
    /* ------------------------------- summaries ------------------------------- */
    costOf(projectId, usage) {
        let usd = 0;
        let priced = 0;
        let tokens = 0;
        let unpriced = 0;
        for (const u of usage) {
            if (u.projectId !== projectId)
                continue;
            tokens += u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
            if (u.cost.priced) {
                usd += u.cost.amountUsd;
                priced++;
            }
            else
                unpriced++;
        }
        return { spentUsd: priced > 0 ? usd : null, tokens, unpriced };
    }
    summaries(accessible, includeArchived = false) {
        const healths = this.healthMap(accessible);
        const usage = this.ports.usage();
        const runs = this.ports.runs();
        const deps = this.listDependencies(accessible);
        return this.ports
            .projects()
            .filter((f) => accessible(f.projectId))
            .map((f) => {
            const p = this.profile(f.projectId);
            const h = healths.get(f.projectId);
            const pr = runs.filter((r) => r.projectId === f.projectId);
            const active = pr.filter((r) => ["EXECUTING", "WAITING_APPROVAL", "REVIEW", "BLOCKED"].includes(this.ports.deriveRunStatus(r))).length;
            const stack = p.stack.length ? p.stack : (f.stack ?? []);
            const dt = p.deploymentTarget ?? f.deploymentTarget;
            const fp = p.firebaseProject ?? f.firebaseProject;
            const env = p.environment ?? f.environment;
            return {
                projectId: f.projectId,
                name: f.name,
                ...(f.repository ? { repository: f.repository } : {}),
                ...(f.branch ? { branch: f.branch } : {}),
                stack,
                ...(env ? { environment: env } : {}),
                ...(fp ? { firebaseProject: fp } : {}),
                ...(dt ? { deploymentTarget: dt } : {}),
                owner: f.owner ?? "owner",
                priority: p.priority,
                strategicImportance: p.strategicImportance,
                urgency: p.urgency,
                declaredRisk: p.declaredRisk,
                objectives: p.objectives,
                health: h,
                agents: this.ports.agentsFor(f.projectId),
                workflows: { active, total: pr.length },
                cost: this.costOf(f.projectId, usage),
                risks: h.reasons.slice(0, 5),
                dependsOn: deps
                    .filter((d) => d.from === f.projectId)
                    .map((d) => ({ projectId: d.to, kind: d.kind })),
                dependedOnBy: deps
                    .filter((d) => d.to === f.projectId)
                    .map((d) => ({ projectId: d.from, kind: d.kind })),
                archived: p.archived,
            };
        })
            .filter((s) => includeArchived || !s.archived)
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    summary(projectId, accessible) {
        const s = this.summaries(accessible, true).find((x) => x.projectId === projectId);
        if (!s)
            throw new PortfolioError("not_found", "project not found");
        return s;
    }
    /* ------------------------------- priorities ------------------------------- */
    priorities(accessible) {
        const sums = this.summaries(accessible);
        const dependents = new Map();
        for (const s of sums)
            for (const d of s.dependedOnBy)
                dependents.set(s.projectId, (dependents.get(s.projectId) ?? 0) +
                    (this.deps
                        .list()
                        .find((x) => x.from === d.projectId && x.to === s.projectId)
                        ?.weight ?? 1));
        const scored = sums.map((s) => {
            const breakdown = [
                {
                    factor: "priority",
                    points: PRIORITY_POINTS[s.priority],
                    detail: s.priority,
                },
                {
                    factor: "strategic importance",
                    points: s.strategicImportance * 5,
                    detail: `${s.strategicImportance}/5`,
                },
                { factor: "urgency", points: s.urgency * 5, detail: `${s.urgency}/5` },
                {
                    factor: "declared risk",
                    points: s.declaredRisk * 2,
                    detail: `${s.declaredRisk}/5`,
                },
                {
                    factor: "health",
                    points: HEALTH_RISK[s.health.state],
                    detail: s.health.state,
                },
                {
                    factor: "others depend on it",
                    points: Math.min(20, (dependents.get(s.projectId) ?? 0) * 2),
                    detail: `${s.dependedOnBy.length} project(s)`,
                },
            ];
            return {
                projectId: s.projectId,
                score: breakdown.reduce((n, b) => n + b.points, 0),
                breakdown,
                depends: s.dependsOn.map((d) => d.projectId),
                state: s.health.state,
            };
        });
        const byScore = [...scored].sort((a, b) => b.score - a.score || a.projectId.localeCompare(b.projectId));
        // A project that depends on an unhealthy project is handled after it.
        const placed = [];
        const remaining = [...byScore];
        const stateOf = new Map(scored.map((s) => [s.projectId, s.state]));
        while (remaining.length) {
            const idx = remaining.findIndex((c) => !c.depends.some((d) => remaining.some((r) => r.projectId === d) &&
                stateOf.get(d) !== "HEALTHY" &&
                stateOf.get(d) !== "UNKNOWN"));
            placed.push(remaining.splice(idx === -1 ? 0 : idx, 1)[0]);
        }
        return placed.map((p, i) => ({
            rank: i + 1,
            projectId: p.projectId,
            score: p.score,
            breakdown: p.breakdown,
            waitFor: p.depends.filter((d) => stateOf.has(d) &&
                stateOf.get(d) !== "HEALTHY" &&
                stateOf.get(d) !== "UNKNOWN"),
        }));
    }
    /* -------------------------------- dashboard -------------------------------- */
    dashboard(accessible) {
        const sums = this.summaries(accessible);
        const ids = new Set(sums.map((s) => s.projectId));
        const runs = this.ports.runs().filter((r) => ids.has(r.projectId));
        const alerts = this.ports
            .alerts()
            .filter((a) => a.projectId &&
            ids.has(a.projectId) &&
            (a.status === "OPEN" ||
                a.status === "ACKNOWLEDGED" ||
                a.status === ""));
        const count = (s) => sums.filter((x) => x.health.state === s).length;
        const deployments = sums.map((s) => {
            const ts = tasksOf(runs.filter((r) => r.projectId === s.projectId)).filter((t) => t.type === "DEPLOYMENT" &&
                (t.status === "COMPLETED" || t.status === "FAILED"));
            const last = ts
                .map((t) => t.completedAt ?? t.updatedAt)
                .sort()
                .pop();
            return {
                projectId: s.projectId,
                total: ts.length,
                failed: ts.filter((t) => t.status === "FAILED").length,
                ...(last ? { lastAt: last } : {}),
            };
        });
        return {
            generatedAt: this.ports.clock(),
            counts: {
                projects: sums.length,
                active: sums.filter((s) => s.workflows.active > 0).length,
                blocked: count("BLOCKED"),
                atRisk: count("AT_RISK"),
                critical: count("CRITICAL"),
                unknown: count("UNKNOWN"),
                healthy: count("HEALTHY"),
            },
            activeProjects: sums.filter((s) => s.workflows.active > 0),
            blockedProjects: sums
                .filter((s) => s.health.state === "BLOCKED")
                .map((s) => ({ projectId: s.projectId, reasons: s.health.reasons })),
            deployments,
            failures: sums
                .map((s) => {
                const pr = runs.filter((r) => r.projectId === s.projectId);
                return {
                    projectId: s.projectId,
                    failedTasks: tasksOf(pr).filter((t) => t.status === "FAILED")
                        .length,
                    failedRuns: pr.filter((r) => this.ports.deriveRunStatus(r) === "FAILED").length,
                };
            })
                .filter((f) => f.failedTasks > 0 || f.failedRuns > 0),
            security: sums
                .map((s) => {
                const a = alerts.filter((x) => x.projectId === s.projectId);
                return {
                    projectId: s.projectId,
                    openAlerts: a.length,
                    critical: a.filter((x) => x.severity === "CRITICAL" || x.severity === "HIGH").length,
                };
            })
                .filter((x) => x.openAlerts > 0),
            costs: sums.map((s) => ({ projectId: s.projectId, ...s.cost })),
            upcomingActions: sums.flatMap((s) => {
                const ts = tasksOf(runs.filter((r) => r.projectId === s.projectId));
                const out = [];
                const w = ts.filter((t) => t.status === "WAITING_APPROVAL").length;
                const r = ts.filter((t) => t.status === "READY").length;
                const b = ts.filter((t) => t.status === "BLOCKED").length;
                if (w)
                    out.push({ projectId: s.projectId, kind: "APPROVAL", count: w });
                if (r)
                    out.push({ projectId: s.projectId, kind: "READY_TASK", count: r });
                if (b)
                    out.push({ projectId: s.projectId, kind: "BLOCKED_TASK", count: b });
                return out;
            }),
            dependencies: this.listDependencies(accessible),
            conflicts: this.conflicts(accessible),
        };
    }
    /* ------------------------------- intelligence ------------------------------- */
    attention(s, runs, alerts) {
        const why = [];
        let score = 0;
        const sev = {
            BLOCKED: 50,
            CRITICAL: 40,
            AT_RISK: 20,
            UNKNOWN: 0,
            HEALTHY: 0,
        }[s.health.state];
        if (sev) {
            score += sev;
            why.push(`health is ${s.health.state}`);
        }
        const ts = tasksOf(runs.filter((r) => r.projectId === s.projectId));
        const crit = alerts.filter((a) => a.projectId === s.projectId &&
            (a.severity === "CRITICAL" || a.severity === "HIGH")).length;
        if (crit) {
            score += crit * 10;
            why.push(`${crit} high/critical alert(s)`);
        }
        const waiting = ts.filter((t) => t.status === "WAITING_APPROVAL").length;
        if (waiting) {
            score += waiting * 3;
            why.push(`${waiting} approval(s) waiting`);
        }
        const failed = ts.filter((t) => t.status === "FAILED").length;
        if (failed) {
            score += failed * 2;
            why.push(`${failed} failed task(s)`);
        }
        score += Math.round(PRIORITY_POINTS[s.priority] / 3);
        return { score, why };
    }
    ask(question, accessible) {
        const q = question.trim().slice(0, 300);
        const lower = q.toLowerCase();
        const sums = this.summaries(accessible);
        const runs = this.ports.runs().filter((r) => accessible(r.projectId));
        const alerts = this.ports
            .alerts()
            .filter((a) => !a.projectId || accessible(a.projectId));
        const base = { question: q };
        if (sums.length === 0)
            return {
                ...base,
                intent: "none",
                answer: "There are no accessible projects in the portfolio.",
                data: [],
                basis: [],
                confidence: "NO_DATA",
            };
        const evidence = sums.reduce((n, s) => n + s.health.evidenceCount, 0);
        const conf = evidence === 0
            ? "NO_DATA"
            : evidence < 5
                ? "LIMITED_DATA"
                : "ESTABLISHED";
        if (/(attention|focus|first|prioriti)/.test(lower)) {
            const ranked = sums
                .map((s) => ({ s, ...this.attention(s, runs, alerts) }))
                .sort((a, b) => b.score - a.score);
            const top = ranked[0];
            const data = ranked
                .slice(0, 5)
                .map((r) => ({
                projectId: r.s.projectId,
                score: r.score,
                reasons: r.why,
            }));
            return {
                ...base,
                intent: "attention",
                answer: top.score === 0
                    ? "No project shows a signal that needs attention; the ranking falls back to the owner's priorities."
                    : `${top.s.name} needs attention first: ${top.why.join(", ")}.`,
                data,
                basis: [
                    "project health",
                    "open alerts",
                    "task states",
                    "owner priority",
                ],
                confidence: conf,
            };
        }
        if (/blocked|stuck|blocker/.test(lower)) {
            const blocked = sums.filter((s) => s.health.state === "BLOCKED");
            return {
                ...base,
                intent: "blocked",
                answer: blocked.length
                    ? `Blocked: ${blocked.map((b) => b.name).join(", ")}.`
                    : "No project is blocked.",
                data: blocked.map((b) => ({
                    projectId: b.projectId,
                    reasons: b.health.reasons,
                })),
                basis: ["task block reasons", "run states"],
                confidence: conf,
            };
        }
        if (/(consum|most.*(ai|cost|token|resource)|expensive|spend|spent)/.test(lower)) {
            const usage = this.ports.usage().filter((u) => accessible(u.projectId));
            const ranked = sums
                .map((s) => ({
                projectId: s.projectId,
                name: s.name,
                ...this.costOf(s.projectId, usage),
            }))
                .sort((a, b) => (b.spentUsd ?? 0) - (a.spentUsd ?? 0) || b.tokens - a.tokens);
            const top = ranked[0];
            const answer = top.tokens === 0
                ? "No AI usage has been recorded for any accessible project."
                : `${top.name} uses the most AI: ${top.tokens.toLocaleString("en-US")} tokens${top.spentUsd !== null ? ` and $${top.spentUsd.toFixed(4)} priced cost` : " (cost not priced)"}${top.unpriced ? `; ${top.unpriced} call(s) could not be priced` : ""}.`;
            return {
                ...base,
                intent: "ai_consumption",
                answer,
                data: ranked,
                basis: ["usage ledger"],
                confidence: top.tokens === 0 ? "NO_DATA" : "ESTABLISHED",
            };
        }
        if (/deploy/.test(lower)) {
            const risks = sums
                .map((s) => this.deploymentRisk(s, runs, alerts))
                .sort((a, b) => b.risk - a.risk);
            const rated = risks.filter((r) => r.rated);
            const top = rated[0];
            return {
                ...base,
                intent: "deployment_risk",
                answer: top && top.risk > 0
                    ? `${top.name} has the highest deployment risk (${top.risk}): ${top.reasons.join("; ")}.`
                    : rated.length
                        ? "No project shows a deployment risk signal."
                        : "There is no deployment, test or alert evidence to rate deployment risk.",
                data: risks,
                basis: ["deployment tasks", "test tasks", "open alerts"],
                confidence: rated.length ? conf : "NO_DATA",
            };
        }
        if (/(same resource|shar|conflict|exclusive)/.test(lower)) {
            const c = this.conflicts(accessible);
            return {
                ...base,
                intent: "shared_resources",
                answer: c.length
                    ? c.map((x) => x.explanation).join(". ") + "."
                    : "No shared or conflicting resources were found.",
                data: c,
                basis: ["declared resource claims", "in-flight tasks"],
                confidence: "ESTABLISHED",
            };
        }
        return {
            ...base,
            intent: "unsupported",
            answer: "I can answer: which project needs attention first, which project is blocked, which project uses the most AI, which has the highest deployment risk, and which projects share a resource.",
            data: [],
            basis: [],
            confidence: "NO_DATA",
        };
    }
    deploymentRisk(s, runs, alerts) {
        const ts = tasksOf(runs.filter((r) => r.projectId === s.projectId));
        const dep = ts.filter((t) => t.type === "DEPLOYMENT");
        const tests = ts.filter((t) => t.type === "TEST");
        const hi = alerts.filter((a) => a.projectId === s.projectId &&
            (a.severity === "CRITICAL" || a.severity === "HIGH")).length;
        const rated = dep.length > 0 || tests.length > 0 || hi > 0;
        const reasons = [];
        let risk = 0;
        if (dep.some((t) => t.status === "FAILED")) {
            risk += 40;
            reasons.push("a deployment failed");
        }
        if (tests.some((t) => t.status === "FAILED")) {
            risk += 25;
            reasons.push("tests failed");
        }
        if (tests.length > 0 && !tests.some((t) => t.result?.verified === true)) {
            risk += 10;
            reasons.push("no verified test result");
        }
        if (hi) {
            risk += 20;
            reasons.push(`${hi} high/critical security alert(s)`);
        }
        if (dep.some((t) => t.status === "WAITING_APPROVAL")) {
            risk += 5;
            reasons.push("a deployment is waiting for approval");
        }
        if ((s.environment ?? "").toUpperCase() === "PRODUCTION" && risk > 0) {
            risk += 10;
            reasons.push("production target");
        }
        return { projectId: s.projectId, name: s.name, risk, rated, reasons };
    }
    /* ---------------------------- cross-project knowledge ---------------------------- */
    reusableKnowledge(accessible) {
        const out = [];
        const groups = new Map();
        for (const m of this.ports.memories()) {
            if (!m.projectId || !accessible(m.projectId) || m.status !== "ACTIVE")
                continue;
            if (m.type !== "ARCHITECTURAL" && m.type !== "EXECUTION")
                continue;
            for (const tag of m.tags) {
                if (tag.length < 3)
                    continue;
                groups.set(tag, [...(groups.get(tag) ?? []), m]);
            }
        }
        for (const [tag, ms] of groups) {
            const projects = [...new Set(ms.map((m) => m.projectId))];
            if (projects.length < 2)
                continue;
            out.push({
                kind: "PATTERN",
                title: `"${tag}" appears in ${projects.length} projects`,
                projects,
                refs: ms
                    .slice(0, 6)
                    .map((m) => ({ projectId: m.projectId, memoryId: m.memoryId })),
                note: "Candidate for review. Nothing is copied between projects; use the sources as input to a deliberate decision.",
            });
        }
        for (const e of this.ports.reusableExtensions())
            out.push({
                kind: e.kind,
                title: e.name,
                projects: [],
                refs: [{ extensionId: e.extensionId }],
                note: "Platform-wide and enabled; usable by every project.",
            });
        return out.slice(0, 40);
    }
}
