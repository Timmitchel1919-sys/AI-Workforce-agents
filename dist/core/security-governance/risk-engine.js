const ACTION_POINTS = {
    READ: 0,
    ANALYZE: 0,
    CREATE: 1,
    UPDATE: 1,
    EXECUTE: 1,
    PUBLISH: 3,
    DEPLOY: 3,
    DELETE: 3,
    EXPORT: 3,
    SHARE: 3,
    ADMINISTRATIVE: 4,
};
const RESOURCE_POINTS = {
    UI_SOURCE: 0,
    TEST: 0,
    DOCUMENT: 0,
    BRANCH: 0,
    DEPLOY_TARGET: 0,
    SOURCE: 1,
    CONFIG: 1,
    UNKNOWN: 1,
    POLICY: 3,
    NETWORK: 2,
    PROJECT: 2,
    AGENT: 2,
    WORKFLOW: 2,
    INTEGRATION: 2,
    DATABASE: 2,
    AUTH_CODE: 3,
    CI_CONFIG: 3,
    DEPLOY_CONFIG: 3,
    ENVIRONMENT: 3,
    FIREBASE_PROJECT: 3,
    REPOSITORY: 3,
    SECURITY_RULES: 4,
    ENV_FILE: 4,
    INFRASTRUCTURE: 4,
    SECRET: 5,
};
/** Resources whose change reaches many other parts of the system. */
const SHARED = [
    "AUTH_CODE",
    "SECURITY_RULES",
    "CI_CONFIG",
    "DEPLOY_CONFIG",
    "INFRASTRUCTURE",
    "CONFIG",
];
const IRREVERSIBLE_ACTIONS = [
    "DELETE",
    "EXPORT",
    "SHARE",
];
export const levelOfScore = (score) => score >= 7 ? "CRITICAL" : score >= 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";
export const riskRank = (r) => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(r);
export function assessRisk(input) {
    const factors = [];
    const add = (factor, points, detail) => {
        if (points !== 0)
            factors.push({ factor, points, detail });
    };
    const { action, resource, environment } = input;
    add("action", ACTION_POINTS[action], `${action} action`);
    // Reading something harmless adds nothing; reading a secret is already severe.
    const rp = RESOURCE_POINTS[resource.kind];
    add("resource", action === "READ" || action === "ANALYZE" ? (rp >= 4 ? rp : 0) : rp, `${resource.kind.toLowerCase().replace(/_/g, " ")}`);
    if (environment === "PRODUCTION" || resource.production) {
        add("environment", action === "READ" || action === "ANALYZE" ? 1 : 2, "production environment");
    }
    const count = Math.max(1, Math.trunc(input.count ?? 1));
    const bulk = action === "READ" || action === "ANALYZE"
        ? 0
        : count >= 1000
            ? 3
            : count >= 100
                ? 2
                : count >= 10
                    ? 1
                    : 0;
    add("bulk", bulk, `${count} resources affected`);
    let blast = "LOW";
    const shared = SHARED.includes(resource.kind) && action !== "READ" && action !== "ANALYZE";
    if (shared)
        add("blast radius", 1, "shared component / global configuration");
    if (shared || bulk >= 2)
        blast = "MEDIUM";
    if ((shared &&
        (resource.kind === "AUTH_CODE" || resource.kind === "SECURITY_RULES")) ||
        bulk >= 3)
        blast = "HIGH";
    if (resource.kind === "INFRASTRUCTURE" ||
        ((environment === "PRODUCTION" || resource.production) &&
            (shared || bulk >= 2)))
        blast = "CRITICAL";
    const reversible = input.reversible ??
        !(IRREVERSIBLE_ACTIONS.includes(action) ||
            resource.kind === "SECRET" ||
            resource.kind === "FIREBASE_PROJECT");
    if (!reversible)
        add("irreversible", 1, "cannot be undone");
    const dc = input.dataClass ?? resource.dataClass;
    if ((action === "EXPORT" || action === "SHARE" || input.external) &&
        (dc === "SECRET" || dc === "RESTRICTED"))
        add("data sensitivity", 3, `${dc} data leaving the trust boundary`);
    else if (dc === "SECRET" && action !== "READ")
        add("data sensitivity", 2, "credential material involved");
    if (input.agentTrust === "LIMITED")
        add("agent trust", 1, "limited-trust agent");
    if (input.agentTrust === "REVIEW_REQUIRED")
        add("agent trust", 2, "agent requires review");
    const score = factors.reduce((n, f) => n + f.points, 0);
    return {
        level: levelOfScore(score),
        score,
        factors,
        blastRadius: blast,
        reversible,
    };
}
