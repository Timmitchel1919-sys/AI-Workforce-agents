/**
 * EO-4.3 — isolated workspace & repository contracts.
 *
 *   WORKSPACE ≠ HOST FILESYSTEM · FILE WRITE ≠ FILE DELETE ·
 *   REPOSITORY WRITE ≠ GIT COMMIT · GIT COMMIT ≠ GIT PUSH · BUILD ≠ DEPLOY
 *
 * Agents address files only by workspace-relative paths inside a workspace
 * bound to their session. Host paths, repository URLs and credentials never
 * appear in any agent-facing, API or receipt type here.
 */
import { ValidationError } from "./index.js";
import { requireExecutionId, validateSecretReference } from "./execution.js";
/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */
export const WORKSPACE_STATES = [
    "preparing",
    "ready",
    "in_use",
    "dirty",
    "cleaning",
    "closed",
    "failed",
];
export const WORKSPACE_TRANSITIONS = {
    preparing: ["ready", "failed"],
    ready: ["in_use", "cleaning", "failed"],
    in_use: ["ready", "dirty", "failed"],
    dirty: ["in_use", "cleaning", "failed"],
    cleaning: ["closed", "failed"],
    closed: [],
    failed: ["cleaning"],
};
export function canTransitionWorkspace(from, to) {
    return WORKSPACE_TRANSITIONS[from].includes(to);
}
export function validateRepositoryReference(ref) {
    requireExecutionId(ref.repositoryId, "repository.repositoryId");
    requireExecutionId(ref.projectId, "repository.projectId");
    if (!ref.localPath && !ref.remote) {
        throw new ValidationError("repository needs a localPath or a remote");
    }
    if (ref.remote) {
        let url;
        try {
            url = new URL(ref.remote.url);
        }
        catch {
            throw new ValidationError("repository.remote.url must be a URL");
        }
        if (url.protocol !== "https:" || url.username || url.password) {
            throw new ValidationError("repository.remote.url must be https without embedded credentials");
        }
        if (ref.remote.credentialRef) {
            validateSecretReference(ref.remote.credentialRef, "credentialRef");
        }
    }
}
export function repositoryView(ref) {
    return {
        repositoryId: ref.repositoryId,
        projectId: ref.projectId,
        kind: ref.localPath ? "attached" : "remote",
        private: Boolean(ref.remote?.credentialRef),
        ...(ref.defaultBranch ? { defaultBranch: ref.defaultBranch } : {}),
    };
}
export const CHANGESET_STATUSES = [
    "open",
    "ready_for_review",
    "rolled_back",
    "abandoned",
    // EO-4.4 — verification states. VERIFIED is not COMMITTED.
    "verifying",
    "verified",
    "verification_failed",
];
export const DEFAULT_WORKSPACE_FILE_POLICY = {
    maxReadBytes: 256 * 1024,
    maxWriteBytes: 256 * 1024,
    maxListEntries: 200,
    maxSearchResults: 50,
    maxSearchFiles: 2000,
    maxSearchFileBytes: 512 * 1024,
    maxChangedFiles: 100,
    secretPatterns: [
        "**/.env",
        "**/.env.*",
        "**/*.pem",
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/id_rsa*",
        "**/id_ed25519*",
        "**/.npmrc",
        "**/.netrc",
        "**/*service-account*.json",
        "**/credentials*.json",
        "**/.ssh/**",
        "**/secrets/**",
    ],
    protectedPatterns: [
        ".github/workflows/**",
        "**/firebase.json",
        "**/*.rules",
        "**/firestore.indexes.json",
        "infrastructure/**",
        "deploy/**",
        "**/Dockerfile",
        "**/auth/**",
        "**/package-lock.json",
    ],
    generatedPatterns: [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/coverage/**",
        "**/.cache/**",
        "**/*.log",
    ],
};
function globToRegExp(pattern) {
    let out = "^";
    for (let i = 0; i < pattern.length; i += 1) {
        const ch = pattern[i];
        if (ch === "*") {
            if (pattern[i + 1] === "*") {
                // `**/` = zero or more directories; trailing `**` = anything.
                if (pattern[i + 2] === "/") {
                    out += "(?:.*/)?";
                    i += 2;
                }
                else {
                    out += ".*";
                    i += 1;
                }
            }
            else {
                out += "[^/]*";
            }
        }
        else if ("\\^$+?.()|{}[]".includes(ch)) {
            out += `\\${ch}`;
        }
        else {
            out += ch;
        }
    }
    return new RegExp(`${out}$`, "i");
}
function matchesAny(path, patterns) {
    return patterns.some((p) => globToRegExp(p).test(path));
}
/** Classify a CANONICAL workspace-relative path under a policy. */
export function classifyWorkspacePath(path, policy) {
    const lower = path.toLowerCase();
    if (lower === ".git" || lower.startsWith(".git/"))
        return "internal";
    if (matchesAny(path, policy.secretPatterns))
        return "secret";
    if (matchesAny(path, policy.generatedPatterns))
        return "generated";
    if (matchesAny(path, policy.protectedPatterns))
        return "protected";
    return "normal";
}
