/**
 * Resource, environment and data classification — deterministic and pure.
 *
 * A resource reference is a string: a bare path or `file:<path>` for project
 * files, otherwise `<kind>:<name>` (`secret:API_KEY`, `firebase-project:prod`,
 * `deploy:production`, `branch:main`, `database:prod/users`, `repo:acme/aims`).
 */
import { DATA_CLASSES, } from "../../contracts/security-governance.js";
import { containsSecret } from "../prompt-intelligence/secret-scan.js";
const PROD = /(^|[^a-z])(prod|production|live)([^a-z]|$)/i;
const PREFIX_KIND = {
    secret: "SECRET",
    secrets: "SECRET",
    credential: "SECRET",
    cred: "SECRET",
    env: "ENV_FILE",
    repo: "REPOSITORY",
    repository: "REPOSITORY",
    branch: "BRANCH",
    "firebase-project": "FIREBASE_PROJECT",
    firebase: "FIREBASE_PROJECT",
    db: "DATABASE",
    database: "DATABASE",
    infra: "INFRASTRUCTURE",
    infrastructure: "INFRASTRUCTURE",
    deploy: "DEPLOY_TARGET",
    project: "PROJECT",
    agent: "AGENT",
    workflow: "WORKFLOW",
    integration: "INTEGRATION",
    environment: "ENVIRONMENT",
    policy: "POLICY",
    network: "NETWORK",
    host: "NETWORK",
    url: "NETWORK",
};
function classifyPath(rawPath) {
    const p = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const lower = p.toLowerCase();
    const base = lower.split("/").pop() ?? lower;
    if (/(^|\/)\.env(\.|$)/.test(lower) && !/\.env\.example$/.test(lower))
        return { kind: "ENV_FILE", dataClass: "SECRET" };
    if (/\.(pem|key|p12|pfx)$/.test(base) ||
        /^id_(rsa|ed25519|ecdsa)/.test(base) ||
        /service[-_]?account.*\.json$/.test(base) ||
        /credentials?\.json$/.test(base))
        return { kind: "SECRET", dataClass: "SECRET" };
    if (/\.rules$/.test(base) ||
        base === "database.rules.json" ||
        /(^|\/)security[-_]rules\//.test(lower))
        return { kind: "SECURITY_RULES", dataClass: "RESTRICTED" };
    if (/(^|\/)\.github\/workflows\//.test(lower) ||
        base === ".gitlab-ci.yml" ||
        base === "dockerfile" ||
        base === "cloudbuild.yaml" ||
        base === "jenkinsfile")
        return { kind: "CI_CONFIG", dataClass: "CONFIDENTIAL" };
    if ([
        "firebase.json",
        ".firebaserc",
        "firestore.indexes.json",
        "apphosting.yaml",
        "vercel.json",
    ].includes(base))
        return { kind: "DEPLOY_CONFIG", dataClass: "CONFIDENTIAL" };
    if (/(^|\/)(migrations?|db|database|schema)\//.test(lower) ||
        /(^|[._-])(migration|schema)[._-]/.test(base))
        return { kind: "DATABASE", dataClass: "CONFIDENTIAL" };
    if (/(auth|session|token|permission|rbac|credential|password|oauth|jwt|acl)/.test(base) &&
        /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java)$/.test(base) &&
        !/\.(test|spec)\./.test(base))
        return { kind: "AUTH_CODE", dataClass: "CONFIDENTIAL" };
    if (/(\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)tests?\/)/.test(lower))
        return { kind: "TEST", dataClass: "INTERNAL" };
    if (/\.(md|mdx|txt|rst)$/.test(base) || /(^|\/)docs?\//.test(lower))
        return { kind: "DOCUMENT", dataClass: "INTERNAL" };
    if (/\.(css|scss|sass|less|svg|png|jpe?g|gif|ico|woff2?)$/.test(base) ||
        (/\.(tsx|jsx|vue|svelte)$/.test(base) &&
            /(^|\/)(components?|pages?|ui|views?|styles?|screens?)\//.test(lower)))
        return { kind: "UI_SOURCE", dataClass: "INTERNAL" };
    if (["package.json", "tsconfig.json", "package-lock.json"].includes(base) ||
        /\.config\.(js|ts|mjs|cjs|json)$/.test(base) ||
        /^(\.eslintrc|\.prettierrc|vite\.config)/.test(base))
        return { kind: "CONFIG", dataClass: "INTERNAL" };
    if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rs|cs|php|rb|sh|sql)$/.test(base))
        return { kind: "SOURCE", dataClass: "INTERNAL" };
    return { kind: "UNKNOWN", dataClass: "INTERNAL" };
}
export function describeResource(ref, envHint) {
    const text = (ref ?? "").trim();
    const colon = text.indexOf(":");
    const prefix = colon > 0 ? text.slice(0, colon).toLowerCase() : "";
    const rest = colon > 0 ? text.slice(colon + 1) : text;
    const fromPrefix = PREFIX_KIND[prefix];
    const production = envHint === "PRODUCTION" || PROD.test(text);
    if (fromPrefix) {
        const dataClass = fromPrefix === "SECRET" || fromPrefix === "ENV_FILE"
            ? "SECRET"
            : fromPrefix === "DATABASE" ||
                fromPrefix === "FIREBASE_PROJECT" ||
                fromPrefix === "INFRASTRUCTURE"
                ? "CONFIDENTIAL"
                : "INTERNAL";
        return {
            ref: text,
            kind: fromPrefix,
            label: `${prefix}: ${rest}`,
            dataClass,
            production,
        };
    }
    const path = (prefix === "file" ? rest : text).replace(/\\/g, "/");
    const c = classifyPath(path);
    return {
        ref: text,
        kind: c.kind,
        label: path,
        dataClass: c.dataClass,
        production,
        path,
    };
}
/** Does the text carry a credential? Classifies the data accordingly. */
export function classifyContent(content, floor = "INTERNAL") {
    if (!content)
        return floor;
    if (containsSecret(content))
        return "SECRET";
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content))
        return "SECRET";
    return floor;
}
export const dataClassRank = (c) => DATA_CLASSES.indexOf(c);
export const maxDataClass = (a, b) => dataClassRank(a) >= dataClassRank(b) ? a : b;
/** Environment mentioned in free text; `undefined` when nothing is said. */
export function inferEnvironment(text) {
    const t = text.toLowerCase();
    if (/(^|[^a-z])(prod|production|live|productie)([^a-z]|$)/.test(t))
        return "PRODUCTION";
    if (/(^|[^a-z])(staging|stage|acceptance|acceptatie)([^a-z]|$)/.test(t))
        return "STAGING";
    if (/(^|[^a-z])(test|testing|qa)([^a-z]|$)/.test(t))
        return "TEST";
    if (/(^|[^a-z])(dev|development|local|ontwikkeling)([^a-z]|$)/.test(t))
        return "DEVELOPMENT";
    return undefined;
}
/** Map a Layer 5 tool operation to an action class. */
export function actionForOperation(operation) {
    switch (operation) {
        case "read":
        case "tree":
        case "status":
        case "diff":
            return "READ";
        case "create":
            return "CREATE";
        case "update":
        case "rename":
        case "move":
            return "UPDATE";
        case "delete":
            return "DELETE";
        case "commit":
        case "push":
            return "PUBLISH";
        case "deploy":
            return "DEPLOY";
        default:
            return "EXECUTE";
    }
}
export const SENSITIVE_KINDS = [
    "SECURITY_RULES",
    "AUTH_CODE",
    "CI_CONFIG",
    "DEPLOY_CONFIG",
    "ENV_FILE",
    "SECRET",
    "DATABASE",
    "INFRASTRUCTURE",
    "FIREBASE_PROJECT",
];
