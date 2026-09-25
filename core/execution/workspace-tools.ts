/**
 * EO-4.3 registered workspace + repository operations.
 *
 * WORKSPACE ≠ HOST FILESYSTEM · FILE WRITE ≠ FILE DELETE ·
 * REPOSITORY WRITE ≠ GIT COMMIT · GIT COMMIT ≠ GIT PUSH.
 *
 * Agents address these by `{ toolId, operationId, input }` only. There is no
 * raw git, no git flags, no host path, no stage/commit/push/branch operation.
 * Repository operations run a trusted `git` with FIXED, hardened, read-only
 * argument templates (hooks/fsmonitor/external diff/textconv/pager/credential
 * helpers disabled, every network protocol denied).
 */
import type {
  ExecutionOperationDefinition,
  ExecutionToolDefinition,
  OperationInputField,
} from "../../contracts/index.js";

const PATH: OperationInputField = { kind: "workspace_path", required: true };
const CONTENT: OperationInputField = {
  kind: "text",
  maxBytes: 256 * 1024,
  required: true,
};
const EXPECTED_HASH: OperationInputField = { kind: "sha256", required: true };

function workspaceOp(
  id: string,
  requiredCapabilities: ExecutionOperationDefinition["requiredCapabilities"],
  workspaceAccess: "read" | "write",
  input: ExecutionOperationDefinition["input"],
  risk: ExecutionOperationDefinition["risk"] = "low",
  description = id,
): ExecutionOperationDefinition {
  return {
    id,
    toolId: "workspace",
    stageKind: "build",
    description,
    requiredCapabilities,
    // Writes to protected paths additionally need a policy-granted capability.
    ...(workspaceAccess === "write"
      ? { optionalCapabilities: ["filesystem.write.protected" as const] }
      : {}),
    risk,
    input,
    output: { kind: "json" },
    workspaceAccess,
    networkAccess: "none",
    timeoutMs: 30_000,
  };
}

export const WORKSPACE_OPERATIONS: readonly ExecutionOperationDefinition[] = [
  workspaceOp(
    "workspace.file.read",
    ["filesystem.read"],
    "read",
    { path: PATH },
    "low",
    "Read one text file (bounded).",
  ),
  workspaceOp(
    "workspace.file.stat",
    ["filesystem.read"],
    "read",
    { path: PATH },
    "low",
    "File metadata and content hash.",
  ),
  workspaceOp(
    "workspace.file.list",
    ["filesystem.read"],
    "read",
    {
      path: { kind: "workspace_path" },
      offset: { kind: "integer", min: 0, max: 100_000 },
      limit: { kind: "integer", min: 1, max: 200 },
    },
    "low",
    "List one directory (paginated, non-recursive).",
  ),
  workspaceOp(
    "workspace.file.search",
    ["filesystem.read"],
    "read",
    {
      query: { kind: "text", maxBytes: 200, required: true },
      path: { kind: "workspace_path" },
    },
    "low",
    "Literal text search inside the workspace (bounded).",
  ),
  workspaceOp(
    "workspace.file.create",
    ["filesystem.write.workspace"],
    "write",
    { path: PATH, content: CONTENT },
    "medium",
    "Create a new file (never overwrites).",
  ),
  workspaceOp(
    "workspace.file.update",
    ["filesystem.write.workspace"],
    "write",
    { path: PATH, content: CONTENT, expectedHash: EXPECTED_HASH },
    "medium",
    "Replace a file whose current hash matches expectedHash.",
  ),
  workspaceOp(
    "workspace.file.delete",
    ["filesystem.delete.workspace"],
    "write",
    { path: PATH, expectedHash: EXPECTED_HASH },
    "medium",
    "Delete a file whose current hash matches expectedHash.",
  ),
  workspaceOp(
    "workspace.file.move",
    ["filesystem.write.workspace", "filesystem.delete.workspace"],
    "write",
    { path: PATH, to: PATH, expectedHash: EXPECTED_HASH },
    "medium",
    "Rename a file (no overwrite).",
  ),
  // EO-4.4: in-process secret scan. Reports path/line/rule only, never values.
  {
    ...workspaceOp(
      "workspace.security.secretScan",
      ["filesystem.read", "security.scan.invoke"],
      "read",
      {},
      "low",
      "Scan workspace source for leaked secrets (path/line/rule only).",
    ),
    stageKind: "security",
    executionClass: "adapter",
    timeoutMs: 60_000,
  },
];

export const WORKSPACE_TOOL: ExecutionToolDefinition = {
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
].map((value) => ({ kind: "literal" as const, value }));

const lit = (...values: string[]) =>
  values.map((value) => ({ kind: "literal" as const, value }));

function repositoryOp(
  id: string,
  input: ExecutionOperationDefinition["input"],
  description: string,
): ExecutionOperationDefinition {
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

export const REPOSITORY_OPERATIONS: readonly ExecutionOperationDefinition[] = [
  repositoryOp("repository.status", {}, "Working tree status (structured)."),
  repositoryOp(
    "repository.diff",
    {},
    "Unified diff of unstaged changes (bounded, redacted).",
  ),
  repositoryOp(
    "repository.log",
    { limit: { kind: "integer", min: 1, max: 50, required: true } },
    "Recent history (bounded).",
  ),
  repositoryOp("repository.currentBranch", {}, "Current branch name."),
  repositoryOp(
    "repository.changedFiles",
    {},
    "Changed files, split into pre-existing vs session changes.",
  ),
];

const STATUS_ARGS = lit(
  "status",
  "--porcelain=v1",
  "-z",
  "--branch",
  "--untracked-files=all",
);

export const REPOSITORY_TOOL: ExecutionToolDefinition = {
  toolId: "repository",
  version: "1.0.0",
  displayName: "Repository (read-only)",
  description:
    "Read-only repository inspection. No stage, commit, branch or push.",
  requiredCapabilities: ["repository.read"],
  supportedEnvironmentCapabilities: [],
  executable: {
    executableId: "git",
    operations: {
      "repository.status": [...GIT_SAFE, ...STATUS_ARGS],
      "repository.changedFiles": [...GIT_SAFE, ...STATUS_ARGS],
      "repository.diff": [
        ...GIT_SAFE,
        ...lit(
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "-U3",
        ),
      ],
      "repository.log": [
        ...GIT_SAFE,
        ...lit(
          "log",
          "--no-color",
          "--format=%H%x1f%an%x1f%aI%x1f%s%x1e",
          "-n",
        ),
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
