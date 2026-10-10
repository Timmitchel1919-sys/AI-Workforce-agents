export const NODE_VERSION_OPERATION = {
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
export const NODE_DIAGNOSTIC_TOOL = {
    toolId: "node",
    version: "1.0.0",
    displayName: "Node.js (diagnostics)",
    description: "Bounded, read-only Node.js diagnostics. No scripts, no installs.",
    requiredCapabilities: ["process.invoke.bounded"],
    supportedEnvironmentCapabilities: [],
    executable: {
        executableId: "node",
        operations: { "node.version": [{ kind: "literal", value: "--version" }] },
        environmentVariables: [],
    },
    operations: ["node.version"],
};
