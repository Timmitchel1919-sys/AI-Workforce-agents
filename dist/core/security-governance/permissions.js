const WRITE = ["CREATE", "UPDATE", "DELETE"];
const SENSITIVE_WRITE = [
    "SECURITY_RULES",
    "AUTH_CODE",
    "CI_CONFIG",
    "DEPLOY_CONFIG",
    "DATABASE",
    "INFRASTRUCTURE",
];
const CODE_KINDS = [
    "SOURCE",
    "UI_SOURCE",
    "TEST",
    "DOCUMENT",
    "CONFIG",
    "UNKNOWN",
];
/** Resource kinds each task type may create/update/delete (sensitive kinds additionally need the scope rule). */
const WRITABLE = {
    DEVELOPMENT: [...CODE_KINDS, ...SENSITIVE_WRITE],
    MAINTENANCE: [...CODE_KINDS, ...SENSITIVE_WRITE],
    DESIGN: ["UI_SOURCE", "DOCUMENT"],
    TEST: ["TEST", "DOCUMENT"],
    DOCUMENTATION: ["DOCUMENT"],
    REVIEW: [],
    SECURITY: [],
    ANALYSIS: [],
    RESEARCH: [],
    INTEGRATION: [],
    DEPLOYMENT: [],
};
const PUBLISHERS = {
    INTEGRATION: ["BRANCH"],
    DEPLOYMENT: ["DEPLOY_TARGET", "BRANCH"],
};
function inScope(path, ref, scope) {
    if (!scope || scope.length === 0)
        return false;
    const p = (path ?? ref)
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .toLowerCase();
    return scope.some((s) => {
        const q = s
            .replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .replace(/^file:/, "")
            .toLowerCase();
        return p === q || p.startsWith(q.endsWith("/") ? q : `${q}/`);
    });
}
export function checkPermission(req, resource) {
    // Only agent requests are narrowed by a task profile; human principals use role-based access.
    if (!req.agentId)
        return { ok: true, reason: "no agent profile applies", rule: "ok" };
    const a = req.action;
    if (a === "READ" || a === "ANALYZE" || a === "EXECUTE")
        return {
            ok: true,
            reason: "read/execute is within every task profile",
            rule: "ok",
        };
    // External systems reached through the integration hub: read-only task types may not change them;
    // everything else is decided by risk, policy and approval (sending and publishing always need a human).
    if (resource.kind === "INTEGRATION" &&
        a !== "ADMINISTRATIVE" &&
        a !== "EXPORT") {
        if (["REVIEW", "SECURITY", "ANALYSIS", "RESEARCH", "TEST"].includes(req.taskType ?? ""))
            return {
                ok: false,
                reason: `a ${req.taskType} task may not change external systems (least privilege)`,
                rule: "task_profile",
            };
        return {
            ok: true,
            reason: "external side effects are decided by policy and approval",
            rule: "ok",
        };
    }
    if (a === "EXPORT" || a === "SHARE" || a === "ADMINISTRATIVE")
        return {
            ok: false,
            reason: `agents may not perform ${a} actions`,
            rule: "agent_action",
        };
    const type = req.taskType ?? "UNKNOWN";
    if (a === "PUBLISH" || a === "DEPLOY") {
        const kinds = PUBLISHERS[type];
        if (req.skipTaskProfile)
            return { ok: true, reason: "assessed at task level", rule: "ok" };
        if (a === "DEPLOY" && type !== "DEPLOYMENT")
            return {
                ok: false,
                reason: `a ${type} task may not deploy (least privilege)`,
                rule: "task_profile",
            };
        if (!kinds || !kinds.includes(resource.kind))
            return {
                ok: false,
                reason: `a ${type} task may not ${a.toLowerCase()} ${resource.kind.toLowerCase().replace(/_/g, " ")} (least privilege)`,
                rule: "task_profile",
            };
        return {
            ok: true,
            reason: "task profile allows publishing here",
            rule: "ok",
        };
    }
    if (WRITE.includes(a)) {
        const sensitive = SENSITIVE_WRITE.includes(resource.kind);
        const kinds = req.skipTaskProfile
            ? [...CODE_KINDS, ...SENSITIVE_WRITE]
            : WRITABLE[type];
        if (kinds === undefined) {
            // Unknown task type: only an explicitly declared resource may be written.
            return inScope(resource.path, resource.ref, req.expectedScope)
                ? {
                    ok: true,
                    reason: "resource is declared in the task scope",
                    rule: "ok",
                }
                : {
                    ok: false,
                    reason: "the task type is unknown and the resource is not in its declared scope",
                    rule: "task_profile",
                };
        }
        if (!kinds.includes(resource.kind))
            return {
                ok: false,
                reason: `a ${type} task may not ${a.toLowerCase()} ${resource.kind.toLowerCase().replace(/_/g, " ")} (least privilege)`,
                rule: "task_profile",
            };
        if (sensitive && !inScope(resource.path, resource.ref, req.expectedScope))
            return {
                ok: false,
                reason: `${resource.kind.toLowerCase().replace(/_/g, " ")} "${resource.label}" is sensitive and was not declared in this task's scope`,
                rule: "sensitive_scope",
            };
    }
    return {
        ok: true,
        reason: "within the task's least-privilege profile",
        rule: "ok",
    };
}
