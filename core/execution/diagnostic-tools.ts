/**
 * EO-4.2 initial allowlist: ONE safe, read-only diagnostic operation.
 *
 * The agent requests `node.version`; the tool owns the exact executable
 * (`executableId: "node"`, resolved to an absolute path by trusted
 * composition) and the exact argv (`--version`). Nothing about it is
 * model-supplied, and it touches no workspace and no network.
 */
import type {
  ExecutionOperationDefinition,
  ExecutionToolDefinition,
} from "../../contracts/index.js";

export const NODE_VERSION_OPERATION: ExecutionOperationDefinition = {
  id: "node.version",
  toolId: "node",
  stageKind: "build",
  description: "Report the version of the Node.js toolchain on the host.",
  requiredCapabilities: ["process.invoke.bounded"],
  risk: "low",
  input: {},
  output: { kind: "semver" },
  requiredToolchains: ["node"],
  workspaceAccess: "none",
  networkAccess: "none",
  timeoutMs: 10_000,
};

export const NODE_DIAGNOSTIC_TOOL: ExecutionToolDefinition = {
  toolId: "node",
  version: "1.0.0",
  displayName: "Node.js (diagnostics)",
  description:
    "Bounded, read-only Node.js diagnostics. No scripts, no installs.",
  requiredCapabilities: ["process.invoke.bounded"],
  supportedEnvironmentCapabilities: [],
  executable: {
    executableId: "node",
    operations: { "node.version": [{ kind: "literal", value: "--version" }] },
    environmentVariables: [],
  },
  operations: ["node.version"],
};
