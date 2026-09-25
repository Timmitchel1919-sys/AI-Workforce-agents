/**
 * EO-4.4 build/test tool definitions — trusted composition only.
 *
 * NO GENERAL-PURPOSE TERMINAL. A build tool is ONE trusted executable with a
 * FIXED argument vector per operation, chosen by the repository owner in
 * composition — never by an agent (there is no input that reaches argv, no
 * `npm run <string>`). Shells and interpreters-with-eval are refused, and so
 * are dependency installation, publishing and deployment arguments:
 * dependencies must already be present (DEPENDENCY_MISSING otherwise).
 *
 * The platform presets below are DATA ONLY. They are not registered in
 * production; a platform becomes runnable only when an environment instance
 * reports its toolchain and composition registers the tool explicitly.
 */
import { ValidationError, requireExecutionId, resolveWorkspacePath, } from "../../contracts/index.js";
/** Executables that are, or embed, a general-purpose command interpreter. */
const FORBIDDEN_EXECUTABLES = new Set([
    "sh",
    "bash",
    "zsh",
    "fish",
    "cmd",
    "cmd.exe",
    "powershell",
    "pwsh",
    "terminal",
    "shell",
    "eval",
    "env",
    "xargs",
    "npx",
    "bunx",
]);
/** Arguments that install, publish, deploy, push or evaluate code. */
const FORBIDDEN_ARGUMENTS = new Set([
    "install",
    "i",
    "ci",
    "add",
    "update",
    "upgrade",
    "restore",
    "publish",
    "deploy",
    "push",
    "release",
    "upload",
    "exec",
    "dlx",
    "run-script",
    "-e",
    "--eval",
    "-p",
    "--print",
    "-c",
    "--command",
    "-Command",
    "-EncodedCommand",
]);
const CAPABILITIES = {
    build: ["filesystem.read", "build.invoke"],
    test: ["filesystem.read", "test.invoke"],
    security: ["filesystem.read", "security.scan.invoke"],
};
/**
 * Validate a trusted build tool spec and produce its tool + operations.
 * Throws ValidationError for shells, eval flags, install/publish/deploy
 * arguments, unsafe paths or empty argv.
 */
export function defineBuildTool(spec) {
    requireExecutionId(spec.toolId, "toolId");
    requireExecutionId(spec.executableId, "executableId");
    if (FORBIDDEN_EXECUTABLES.has(spec.executableId.toLowerCase())) {
        throw new ValidationError(`${spec.executableId} is a command interpreter and is never a build tool`);
    }
    if (spec.commands.length === 0) {
        throw new ValidationError("a build tool needs at least one command");
    }
    const operations = spec.commands.map((command) => {
        requireExecutionId(command.operationId, "operationId");
        if (command.argv.length === 0 || command.argv.length > 32) {
            throw new ValidationError(`${command.operationId}: argv must be 1-32`);
        }
        for (const arg of command.argv) {
            if (typeof arg !== "string" ||
                arg.length === 0 ||
                arg.length > 256 ||
                FORBIDDEN_ARGUMENTS.has(arg) ||
                /[\0\r\n]/.test(arg)) {
                throw new ValidationError(`${command.operationId}: argument "${String(arg).slice(0, 40)}" is not allowed`);
            }
        }
        command.requiredPaths?.forEach((p) => resolveWorkspacePath(p));
        const access = command.workspaceAccess ?? "read";
        const op = {
            id: command.operationId,
            toolId: spec.toolId,
            stageKind: command.stageKind,
            description: command.description,
            requiredCapabilities: [
                ...CAPABILITIES[command.stageKind],
                ...(access === "write"
                    ? ["filesystem.write.workspace"]
                    : []),
            ],
            risk: "medium",
            input: {},
            output: command.output ?? { kind: "text" },
            requiredToolchains: spec.requiredToolchains,
            workspaceAccess: access,
            networkAccess: "none",
            executionClass: "project_code",
            ...(command.timeoutMs ? { timeoutMs: command.timeoutMs } : {}),
        };
        return op;
    });
    const requiredPaths = Object.fromEntries(spec.commands
        .filter((c) => (c.requiredPaths ?? []).length > 0)
        .map((c) => [c.operationId, c.requiredPaths]));
    const tool = {
        toolId: spec.toolId,
        version: "1.0.0",
        displayName: spec.displayName ?? spec.toolId,
        description: `Fixed build/test commands for ${spec.executableId}.`,
        requiredCapabilities: [],
        supportedEnvironmentCapabilities: [],
        executable: {
            executableId: spec.executableId,
            operations: Object.fromEntries(spec.commands.map((c) => [
                c.operationId,
                c.argv.map((value) => ({ kind: "literal", value })),
            ])),
            environmentVariables: spec.environmentVariables ?? [],
            ...(Object.keys(requiredPaths).length > 0 ? { requiredPaths } : {}),
        },
        operations: spec.commands.map((c) => c.operationId),
    };
    return { tool, operations };
}
/**
 * Platform presets (data only, NOT registered). Each assumes dependencies
 * were restored by a trusted, reviewed process beforehand — the presets
 * never restore, install, sign, upload or deploy.
 */
export const BUILD_PROFILE_PRESETS = {
    dotnet: {
        toolId: "dotnet-build",
        executableId: "dotnet",
        requiredToolchains: ["dotnet"],
        commands: [
            {
                operationId: "dotnet.build",
                stageKind: "build",
                description: "dotnet build (no restore).",
                argv: ["build", "--no-restore", "--nologo"],
                workspaceAccess: "write",
            },
            {
                operationId: "dotnet.test",
                stageKind: "test",
                description: "dotnet test (no build, no restore).",
                argv: ["test", "--no-build", "--no-restore", "--nologo"],
            },
        ],
    },
    gradle: {
        toolId: "gradle-build",
        executableId: "gradle",
        requiredToolchains: ["java", "gradle"],
        commands: [
            {
                operationId: "gradle.assemble",
                stageKind: "build",
                description: "Offline Gradle assemble.",
                argv: ["--offline", "--no-daemon", "assembleDebug"],
                workspaceAccess: "write",
            },
            {
                operationId: "gradle.test",
                stageKind: "test",
                description: "Offline Gradle unit tests.",
                argv: ["--offline", "--no-daemon", "test"],
                workspaceAccess: "write",
            },
        ],
    },
    xcode: {
        toolId: "xcode-build",
        executableId: "xcodebuild",
        requiredToolchains: ["xcode"],
        commands: [
            {
                operationId: "xcode.build",
                stageKind: "build",
                description: "xcodebuild build (no signing).",
                argv: ["build", "CODE_SIGNING_ALLOWED=NO"],
                workspaceAccess: "write",
            },
        ],
    },
    unity: {
        toolId: "unity-build",
        executableId: "unity",
        requiredToolchains: ["unity"],
        commands: [
            {
                operationId: "unity.editmode-tests",
                stageKind: "test",
                description: "Unity edit-mode tests (batch mode).",
                argv: [
                    "-batchmode",
                    "-nographics",
                    "-runTests",
                    "-testPlatform",
                    "EditMode",
                ],
                workspaceAccess: "write",
            },
        ],
    },
    unreal: {
        toolId: "unreal-build",
        executableId: "unreal-uat",
        requiredToolchains: ["unreal"],
        commands: [
            {
                operationId: "unreal.build",
                stageKind: "build",
                description: "Unreal BuildCookRun without packaging or deploy.",
                argv: ["BuildCookRun", "-build", "-nop4", "-unattended"],
                workspaceAccess: "write",
            },
        ],
    },
};
