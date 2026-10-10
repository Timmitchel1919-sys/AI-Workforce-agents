const PATH = { kind: "workspace_path", required: true };
const CONTENT = {
    kind: "text",
    maxBytes: 256 * 1024,
    required: true,
};
const EXPECTED_HASH = { kind: "sha256", required: true };
function workspaceOp(id, requiredCapabilities, workspaceAccess, input, risk = "low", description = id) {
    return {
        id,
        toolId: "workspace",
        stageKind: "build",
        description,
        requiredCapabilities,
        // Writes to protected paths additionally need a policy-granted capability.
        ...(workspaceAccess === "write"
            ? { optionalCapabilities: ["filesystem.write.protected"] }
            : {}),
        risk,
        input,
        output: { kind: "json" },
        workspaceAccess,
        networkAccess: "none",
        timeoutMs: 30_000,
    };
}
export const WORKSPACE_OPERATIONS = [
    workspaceOp("workspace.file.read", ["filesystem.read"], "read", { path: PATH }, "low", "Read one text file (bounded)."),
    workspaceOp("workspace.file.stat", ["filesystem.read"], "read", { path: PATH }, "low", "File metadata and content hash."),
    workspaceOp("workspace.file.list", ["filesystem.read"], "read", {
        path: { kind: "workspace_path" },
        offset: { kind: "integer", min: 0, max: 100_000 },
        limit: { kind: "integer", min: 1, max: 200 },
    }, "low", "List one directory (paginated, non-recursive)."),
    workspaceOp("workspace.file.search", ["filesystem.read"], "read", {
        query: { kind: "text", maxBytes: 200, required: true },
        path: { kind: "workspace_path" },
    }, "low", "Literal text search inside the workspace (bounded)."),
    workspaceOp("workspace.file.create", ["filesystem.write.workspace"], "write", { path: PATH, content: CONTENT }, "medium", "Create a new file (never overwrites)."),
    workspaceOp("workspace.file.update", ["filesystem.write.workspace"], "write", { path: PATH, content: CONTENT, expectedHash: EXPECTED_HASH }, "medium", "Replace a file whose current hash matches expectedHash."),
    workspaceOp("workspace.file.delete", ["filesystem.delete.workspace"], "write", { path: PATH, expectedHash: EXPECTED_HASH }, "medium", "Delete a file whose current hash matches expectedHash."),
    workspaceOp("workspace.file.move", ["filesystem.write.workspace", "filesystem.delete.workspace"], "write", { path: PATH, to: PATH, expectedHash: EXPECTED_HASH }, "medium", "Rename a file (no overwrite)."),
    // EO-4.4: in-process secret scan. Reports path/line/rule only, never values.
    {
        ...workspaceOp("workspace.security.secretScan", ["filesystem.read", "security.scan.invoke"], "read", {}, "low", "Scan workspace source for leaked secrets (path/line/rule only)."),
        stageKind: "security",
        executionClass: "adapter",
        timeoutMs: 60_000,
    },
];
export const WORKSPACE_TOOL = {
    toolId: "workspace",
    version: "1.0.0",
    displayName: "Workspace files",
    description: "Bounded file operations inside the session workspace only.",
    requiredCapabilities: [],
    supportedEnvironmentCapabilities: [],
    // In-process adapter: no argv; validated structured input only.
    executable: {
        executableId: "workspace",
        operations: Object.fromEntries(WORKSPACE_OPERATIONS.map((o) => [o.id, []])),
        environmentVariables: [],
    },
    operations: WORKSPACE_OPERATIONS.map((o) => o.id),
};
/** Fixed hardening prefix for every repository read (never agent-supplied). */
const GIT_SAFE = [
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.pager=cat",
    "-c",
    "diff.external=",
    "-c",
    "credential.helper=",
    "-c",
    "protocol.allow=never",
    "-c",
    "color.ui=false",
    "-c",
    "log.showSignature=false",
].map((value) => ({ kind: "literal", value }));
const lit = (...values) => values.map((value) => ({ kind: "literal", value }));
function repositoryOp(id, input, description) {
    return {
        id,
        toolId: "repository",
        stageKind: "build",
        description,
        requiredCapabilities: ["repository.read"],
        risk: "low",
        input,
        output: { kind: "json" },
        workspaceAccess: "read",
        networkAccess: "none",
        timeoutMs: 30_000,
    };
}
export const REPOSITORY_OPERATIONS = [
    repositoryOp("repository.status", {}, "Working tree status (structured)."),
    repositoryOp("repository.diff", {}, "Unified diff of unstaged changes (bounded, redacted)."),
    repositoryOp("repository.log", { limit: { kind: "integer", min: 1, max: 50, required: true } }, "Recent history (bounded)."),
    repositoryOp("repository.currentBranch", {}, "Current branch name."),
    repositoryOp("repository.changedFiles", {}, "Changed files, split into pre-existing vs session changes."),
];
const STATUS_ARGS = lit("status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all");
export const REPOSITORY_TOOL = {
    toolId: "repository",
    version: "1.0.0",
    displayName: "Repository (read-only)",
    description: "Read-only repository inspection. No stage, commit, branch or push.",
    requiredCapabilities: ["repository.read"],
    supportedEnvironmentCapabilities: [],
    executable: {
        executableId: "git",
        operations: {
            "repository.status": [...GIT_SAFE, ...STATUS_ARGS],
            "repository.changedFiles": [...GIT_SAFE, ...STATUS_ARGS],
            "repository.diff": [
                ...GIT_SAFE,
                ...lit("diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "-U3"),
            ],
            "repository.log": [
                ...GIT_SAFE,
                ...lit("log", "--no-color", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "-n"),
                { kind: "integer_input", input: "limit", min: 1, max: 50 },
            ],
            "repository.currentBranch": [
                ...GIT_SAFE,
                ...lit("rev-parse", "--abbrev-ref", "HEAD"),
            ],
        },
        environmentVariables: [],
    },
    operations: REPOSITORY_OPERATIONS.map((o) => o.id),
};
