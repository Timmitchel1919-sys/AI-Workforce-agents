import { MAX_INSIGHTS, } from "../../contracts/graph.js";
import { truncate } from "./graph-util.js";
const TERMINAL_TASK = new Set(["completed", "cancelled"]);
const TERMINAL_SESSION = new Set([
    "succeeded",
    "failed",
    "timed_out",
    "denied",
    "cancelled",
]);
const MAX_DEPENDENCIES_NAMED = 1;
const SEVERITY_ORDER = {
    critical: 0,
    warning: 1,
    info: 2,
};
function evidenceOf(n) {
    return {
        nodeId: n.id,
        nodeType: n.type,
        label: n.label,
        state: n.state,
        status: n.status,
    };
}
export function deriveInsights(graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const outgoing = new Map();
    const incoming = new Map();
    for (const e of graph.edges) {
        if (!byId.has(e.source) || !byId.has(e.target))
            continue; // never trust a dangling edge
        (outgoing.get(e.source) ?? outgoing.set(e.source, []).get(e.source)).push(e);
        (incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target)).push(e);
    }
    const drafts = [];
    const peers = (id, dir, type) => ((dir === "in" ? incoming : outgoing).get(id) ?? [])
        .filter((e) => e.type === type)
        .map((e) => byId.get(dir === "in" ? e.source : e.target))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const nodes = [...graph.nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    /* ---- tasks: blocked, waiting on a dependency, or blocking others ---- */
    for (const task of nodes.filter((n) => n.type === "TASK")) {
        if (TERMINAL_TASK.has(task.status))
            continue;
        const blocking = (outgoing.get(task.id) ?? [])
            .filter((e) => e.type === "DEPENDS_ON" && e.status === "blocking")
            .map((e) => byId.get(e.target))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        if (task.state === "blocked" ||
            (task.state === "queued" && blocking.length > 0)) {
            if (blocking.length > 0) {
                const first = blocking[0];
                drafts.push({
                    kind: "BLOCKED_TASK",
                    variant: "dependency",
                    severity: task.state === "blocked" ? "warning" : "info",
                    subject: task,
                    params: {
                        task: truncate(task.label, 120),
                        dependency: truncate(first.label, 120),
                        dependencyStatus: first.status,
                        count: blocking.length,
                    },
                    evidence: [task, ...blocking.slice(0, MAX_DEPENDENCIES_NAMED + 4)],
                    recommendations: [
                        { kind: "review_dependency", targetNodeId: first.id },
                    ],
                    limitations: ["as_of_revision"],
                });
            }
            else if (task.status === "awaiting_approval") {
                drafts.push({
                    kind: "BLOCKED_TASK",
                    variant: "approval",
                    severity: "warning",
                    subject: task,
                    params: { task: truncate(task.label, 120) },
                    evidence: [task],
                    recommendations: [{ kind: "inspect", targetNodeId: task.id }],
                    limitations: ["as_of_revision"],
                });
            }
            else {
                drafts.push({
                    kind: "BLOCKED_TASK",
                    variant: "unspecified",
                    severity: "warning",
                    subject: task,
                    params: { task: truncate(task.label, 120), status: task.status },
                    evidence: [task],
                    recommendations: [{ kind: "inspect", targetNodeId: task.id }],
                    // The graph shows the task is blocked; it does not record why.
                    limitations: ["cause_not_recorded", "as_of_revision"],
                });
            }
        }
        // Bottleneck: this unfinished task is what several other unfinished tasks are waiting on.
        const waiting = (incoming.get(task.id) ?? [])
            .filter((e) => e.type === "DEPENDS_ON" && e.status === "blocking")
            .map((e) => byId.get(e.source))
            .filter((n) => !TERMINAL_TASK.has(n.status))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        if (waiting.length >= 2) {
            drafts.push({
                kind: "DEPENDENCY_BOTTLENECK",
                variant: "waiting",
                severity: "info",
                subject: task,
                params: {
                    task: truncate(task.label, 120),
                    status: task.status,
                    count: waiting.length,
                },
                evidence: [task, ...waiting.slice(0, 5)],
                recommendations: [{ kind: "inspect", targetNodeId: task.id }],
                limitations: ["as_of_revision"],
            });
        }
    }
    /* ---- execution sessions that failed ---- */
    for (const session of nodes.filter((n) => n.type === "EXECUTION_SESSION" && n.state === "failed")) {
        const task = peers(session.id, "in", "EXECUTES").find((n) => n.type === "TASK");
        const recommendations = [
            { kind: "inspect", targetNodeId: session.id },
        ];
        // A retry is only worth mentioning when the linked task itself is recorded as failed. The
        // suggestion names the existing command as a label; nothing is invoked.
        if (task && task.status === "failed") {
            recommendations.push({
                kind: "consider_retry",
                targetNodeId: task.id,
                relatedCommand: "retry-task",
            });
        }
        drafts.push({
            kind: "FAILED_EXECUTION",
            variant: "failed",
            severity: "critical",
            subject: session,
            params: { session: truncate(session.label, 120), status: session.status },
            evidence: task ? [session, task] : [session],
            recommendations,
            limitations: ["cause_not_recorded", "as_of_revision"],
        });
    }
    /* ---- approvals waiting for a decision ---- */
    for (const approval of nodes.filter((n) => n.type === "APPROVAL" && n.state === "awaiting_approval")) {
        const subjects = (incoming.get(approval.id) ?? [])
            .filter((e) => e.type === "REQUIRES_APPROVAL")
            .map((e) => byId.get(e.source))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const first = subjects[0];
        drafts.push({
            kind: "WAITING_APPROVAL",
            variant: "waiting",
            severity: first ? "warning" : "info",
            subject: approval,
            params: first
                ? {
                    subject: truncate(first.label, 120),
                    subjectType: first.type,
                    approval: truncate(approval.label, 120),
                }
                : { approval: truncate(approval.label, 120) },
            evidence: first ? [approval, first] : [approval],
            recommendations: [
                {
                    kind: "decide_approval",
                    targetNodeId: approval.id,
                    relatedCommand: "approve",
                },
                { kind: "inspect", targetNodeId: approval.id },
            ],
            limitations: ["as_of_revision"],
        });
    }
    /* ---- environments that cannot run work that needs them ---- */
    // Real vocabulary (graph-environment-fragment.ts): an environment node's state is its BEST route
    // status, so `blocked`/`offline` means NO task routed to it could be placed (requires
    // provisioning / no environment), and its counts say how many tasks needed it. EXECUTES_IN edges
    // exist only for tasks that WERE placed, so they cannot express this. Separately, a session
    // running on an instance that is down is linked by RUNS_ON.
    for (const env of nodes.filter((n) => n.type === "ENVIRONMENT" &&
        (n.state === "offline" || n.state === "blocked"))) {
        const total = Number(env.metadata?.totalTasks ?? 0);
        const routed = Number(env.metadata?.routedTasks ?? 0);
        const unplaced = Number.isFinite(total) && Number.isFinite(routed)
            ? Math.max(0, total - routed)
            : 0;
        const sessions = (incoming.get(env.id) ?? [])
            .filter((e) => e.type === "RUNS_ON")
            .map((e) => byId.get(e.source))
            .filter((n) => n.type === "EXECUTION_SESSION" && !TERMINAL_SESSION.has(n.status))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const count = unplaced + sessions.length;
        if (count === 0)
            continue; // an idle, unavailable environment is not a problem for anyone
        drafts.push({
            kind: "ENVIRONMENT_UNAVAILABLE",
            variant: "unspecified",
            severity: "warning",
            subject: env,
            params: {
                environment: truncate(env.label, 120),
                status: env.status,
                count,
            },
            evidence: [env, ...sessions.slice(0, 5)],
            recommendations: [{ kind: "check_environment", targetNodeId: env.id }],
            limitations: ["cause_not_recorded", "as_of_revision"],
        });
    }
    /* ---- ChangeSets waiting for review (and a grouped view when several are) ---- */
    const waitingReview = nodes.filter((n) => n.type === "CHANGESET" && n.state === "awaiting_review");
    for (const cs of waitingReview) {
        drafts.push({
            kind: "REVIEW_WAITING",
            variant: "waiting",
            severity: "info",
            subject: cs,
            params: {
                changeSet: truncate(cs.label, 120),
                fileCount: Number(cs.metadata?.fileCount ?? 0),
            },
            evidence: [cs],
            recommendations: [{ kind: "review_changeset", targetNodeId: cs.id }],
            limitations: ["as_of_revision"],
        });
    }
    if (waitingReview.length >= 2) {
        // A grouping of the findings above (a count), not a threshold on any risk.
        drafts.push({
            kind: "REVIEW_WAITING",
            variant: "queue",
            severity: "warning",
            subject: waitingReview[0],
            params: { count: waitingReview.length },
            evidence: waitingReview.slice(0, 6),
            recommendations: [
                { kind: "review_changeset", targetNodeId: waitingReview[0].id },
            ],
            limitations: ["as_of_revision"],
        });
    }
    /* ---- deployments: failed, degraded, rolled back, or accepted but not yet verified ---- */
    for (const dep of nodes.filter((n) => n.type === "DEPLOYMENT")) {
        const variant = dep.status === "failed"
            ? "failed"
            : dep.status === "degraded"
                ? "degraded"
                : dep.status === "rolled_back"
                    ? "rolled_back"
                    : // DEPLOYED != VERIFIED: the provider accepted it, post-deploy verification has not passed.
                        dep.status === "deployed"
                            ? "unverified"
                            : undefined;
        if (!variant)
            continue;
        drafts.push({
            kind: "DEPLOYMENT_PROBLEM",
            variant,
            severity: variant === "failed"
                ? "critical"
                : variant === "unverified"
                    ? "info"
                    : "warning",
            subject: dep,
            params: { deployment: truncate(dep.label, 120), status: dep.status },
            evidence: [dep],
            recommendations: [{ kind: "inspect", targetNodeId: dep.id }],
            limitations: variant === "unverified"
                ? ["as_of_revision"]
                : ["cause_not_recorded", "as_of_revision"],
        });
    }
    /* ---- deterministic order, bounded ---- */
    const findings = drafts
        .map((d) => ({
        id: `${d.kind}:${d.variant}:${d.subject.id}`,
        kind: d.kind,
        variant: d.variant,
        severity: d.severity,
        subjectNodeId: d.subject.id,
        params: d.params ?? {},
        evidence: d.evidence.map(evidenceOf),
        recommendations: d.recommendations ?? [],
        limitations: d.limitations ?? ["as_of_revision"],
    }))
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
        findings: findings.slice(0, MAX_INSIGHTS),
        truncated: findings.length > MAX_INSIGHTS,
    };
}
