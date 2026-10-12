const OPEN = new Set(["OPEN", "ACKNOWLEDGED", "NEW", "INVESTIGATING"]);
const isOpenAlert = (a) => OPEN.has(a.status) || a.status === "";
export function tasksOf(runs) {
    return runs.flatMap((r) => r.tasks);
}
function lastOf(tasks, type) {
    return tasks
        .filter((t) => t.type === type && (t.status === "COMPLETED" || t.status === "FAILED"))
        .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))[0];
}
export function computeProjectHealth(input) {
    const runs = input.runs.filter((r) => r.projectId === input.projectId);
    const tasks = tasksOf(runs);
    const alerts = input.alerts.filter((a) => a.projectId === input.projectId && isOpenAlert(a));
    const signals = [];
    const reasons = [];
    const sig = (name, status, detail) => {
        signals.push({ name, status, detail });
        if (status === "BAD" || status === "WARN")
            reasons.push(`${name}: ${detail}`);
    };
    // Execution
    const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const states = sorted.map((r) => input.deriveRunStatus(r));
    if (runs.length === 0)
        sig("Executions", "UNKNOWN", "no execution has run for this project yet");
    else {
        const recent = states.slice(0, 5);
        const failed = recent.filter((s) => s === "FAILED").length;
        if (states[0] === "FAILED")
            sig("Executions", "BAD", `the latest run failed (${failed} of the last ${recent.length} failed)`);
        else if (failed > 0)
            sig("Executions", "WARN", `${failed} of the last ${recent.length} runs failed`);
        else
            sig("Executions", "OK", `${recent.length} recent run(s), none failed`);
    }
    // Tasks
    const blocked = tasks.filter((t) => t.status === "BLOCKED");
    const waiting = tasks.filter((t) => t.status === "WAITING_APPROVAL");
    const failedTasks = tasks.filter((t) => t.status === "FAILED");
    if (tasks.length === 0)
        sig("Tasks", "UNKNOWN", "no tasks");
    else if (blocked.length > 0)
        sig("Tasks", "BAD", `${blocked.length} blocked (${[...new Set(blocked.map((t) => t.blockKind ?? "unknown"))].join(", ")})`);
    else if (failedTasks.length > 0)
        sig("Tasks", "WARN", `${failedTasks.length} failed task(s)`);
    else if (waiting.length > 0)
        sig("Tasks", "WARN", `${waiting.length} waiting for approval`);
    else
        sig("Tasks", "OK", `${tasks.filter((t) => t.status === "COMPLETED").length} of ${tasks.length} completed`);
    // Tests / build
    const test = lastOf(tasks, "TEST");
    if (!test)
        sig("Tests", "UNKNOWN", "no verified test task");
    else if (test.status === "FAILED")
        sig("Tests", "BAD", `the last test task failed (${test.title})`);
    else if (test.result?.verified === true)
        sig("Tests", "OK", "the last test task passed and was verified");
    else
        sig("Tests", "WARN", "the last test task finished but was not verified");
    // Deployment
    const deploy = lastOf(tasks, "DEPLOYMENT");
    if (!deploy)
        sig("Deployment", "UNKNOWN", "no deployment task");
    else if (deploy.status === "FAILED")
        sig("Deployment", "BAD", "the last deployment failed");
    else if (deploy.result?.verified === true)
        sig("Deployment", "OK", "the last deployment was verified");
    else
        sig("Deployment", "WARN", "the last deployment completed but was not verified");
    // Security
    const crit = alerts.filter((a) => a.severity === "CRITICAL" || a.severity === "HIGH");
    if (crit.length > 0)
        sig("Security", "BAD", `${crit.length} open high/critical alert(s)`);
    else if (alerts.length > 0)
        sig("Security", "WARN", `${alerts.length} open alert(s)`);
    else
        sig("Security", "OK", "no open alerts");
    if (input.budget === "EXCEEDED")
        sig("Budget", "BAD", "the AI budget is exceeded");
    else if (input.budget === "WARNING")
        sig("Budget", "WARN", "the AI budget is close to its limit");
    else if (input.budget === "OK")
        sig("Budget", "OK", "within budget");
    if ((input.overdueObjectives ?? 0) > 0)
        sig("Schedule", "WARN", `${input.overdueObjectives} objective(s) past their target date`);
    const evidenceCount = runs.length + tasks.length + alerts.length;
    const bad = signals.filter((s) => s.status === "BAD").length;
    const warn = signals.filter((s) => s.status === "WARN").length;
    const hasBlock = blocked.length > 0 || states.includes("BLOCKED");
    const hasCriticalAlert = alerts.some((a) => a.severity === "CRITICAL");
    let state;
    if (hasBlock)
        state = "BLOCKED";
    else if (bad >= 2 || hasCriticalAlert)
        state = "CRITICAL";
    else if (bad >= 1 || warn >= 1)
        state = "AT_RISK";
    else if (evidenceCount === 0)
        state = "UNKNOWN";
    else
        state = "HEALTHY";
    return {
        projectId: input.projectId,
        state,
        reasons,
        signals,
        evidenceCount,
        computedAt: input.now,
    };
}
const SEVERITY = {
    HEALTHY: 0,
    UNKNOWN: 0,
    AT_RISK: 1,
    CRITICAL: 2,
    BLOCKED: 3,
};
/** Second pass: a project that depends on an unhealthy one inherits a warning (never a downgrade to HEALTHY). */
export function applyDependencyImpact(health, deps, others) {
    const hurt = deps.filter((d) => {
        const h = others.get(d.to);
        return h && (h.state === "BLOCKED" || h.state === "CRITICAL");
    });
    if (hurt.length === 0)
        return health;
    const detail = `depends on ${hurt.map((d) => `${d.to} (${others.get(d.to).state})`).join(", ")}`;
    const signals = [
        ...health.signals,
        { name: "Dependencies", status: "WARN", detail },
    ];
    const state = SEVERITY[health.state] >= 1 ? health.state : "AT_RISK";
    return {
        ...health,
        state,
        signals,
        reasons: [...health.reasons, `Dependencies: ${detail}`],
    };
}
