/**
 * Command policy (Layer 5).
 *
 * There is NO shell. A command is classified from its text and, only if it is
 * on the allow-list, reduced to a structured `CommandSpec` that the process
 * runner turns into a fixed argument vector. Everything else is refused:
 *
 *   SAFE             build / test / lint / typecheck scripts, read-only git
 *   REVIEW_REQUIRED  installs, arbitrary npm scripts, commit/push, deploy —
 *                    never run from the agent surface; governed paths only
 *   BLOCKED          destructive, credential-exposing, arbitrary-code commands
 */
import type {
  CommandClassification,
  CommandSpec,
} from "../../contracts/execution-runtime.js";

const SAFE_SCRIPTS = new Set([
  "build",
  "test",
  "lint",
  "typecheck",
  "type-check",
  "check",
  "coverage",
  "format:check",
  "test:unit",
  "test:integration",
  "verify",
]);
const SCRIPT_NAME = /^[a-z][a-z0-9:_-]{0,40}$/;
const SAFE_GIT_FLAGS = new Set([
  "--stat",
  "--name-only",
  "--name-status",
  "--cached",
  "--staged",
  "--short",
  "--porcelain",
  "--oneline",
]);

const SHELL_METACHARACTERS = /[;&|<>`$()\n\r{}\\]/;

const BLOCKED_PROGRAMS = new Set([
  "rm",
  "rmdir",
  "del",
  "erase",
  "rd",
  "remove-item",
  "format",
  "mkfs",
  "dd",
  "shutdown",
  "reboot",
  "sudo",
  "su",
  "chmod",
  "chown",
  "curl",
  "wget",
  "invoke-webrequest",
  "iwr",
  "powershell",
  "pwsh",
  "cmd",
  "bash",
  "sh",
  "zsh",
  "python",
  "python3",
  "perl",
  "ruby",
  "eval",
  "ssh",
  "scp",
  "nc",
  "ncat",
  "cat",
  "type",
  "more",
  "less",
  "head",
  "tail",
  "printenv",
  "env",
  "set",
  "export",
  "get-content",
  "gcloud",
  "aws",
  "az",
  "kubectl",
  "terraform",
  "docker",
  "npx",
  "node",
]);

export interface ClassifyOptions {
  /** npm scripts the workspace actually declares (unknown scripts are refused). */
  scripts?: readonly string[];
}

export function classifyCommand(
  line: unknown,
  options: ClassifyOptions = {},
): CommandClassification {
  if (typeof line !== "string" || line.trim() === "" || line.length > 300) {
    return {
      class: "BLOCKED",
      reason: "command must be a non-empty string of at most 300 characters",
    };
  }
  if (SHELL_METACHARACTERS.test(line)) {
    return {
      class: "BLOCKED",
      reason: "shell metacharacters are not allowed (there is no shell)",
    };
  }
  const tokens = line.trim().split(/\s+/);
  const program = tokens[0]!.toLowerCase();
  const args = tokens.slice(1);

  if (BLOCKED_PROGRAMS.has(program)) {
    return {
      class: "BLOCKED",
      reason: `"${program}" is not an allowed program (destructive, credential-exposing or arbitrary code)`,
    };
  }

  if (program === "npm") {
    const sub = (args[0] ?? "").toLowerCase();
    if (sub === "test" || sub === "t")
      return scriptCommand("test", args.slice(1), options);
    if (sub === "run" || sub === "run-script")
      return scriptCommand(args[1], args.slice(2), options);
    if (sub === "install" || sub === "i" || sub === "ci" || sub === "add") {
      return {
        class: "REVIEW_REQUIRED",
        reason:
          "installing dependencies changes the supply chain and needs review",
        spec: { kind: "install" },
      };
    }
    return { class: "BLOCKED", reason: `"npm ${sub}" is not allowed` };
  }

  if (program === "git") {
    const sub = (args[0] ?? "").toLowerCase();
    const rest = args.slice(1);
    if (["status", "diff", "log", "branch"].includes(sub)) {
      if (rest.some((a) => !SAFE_GIT_FLAGS.has(a) && !/^-\d{1,3}$/.test(a))) {
        return {
          class: "BLOCKED",
          reason: "only fixed read-only git flags are allowed",
        };
      }
      return {
        class: "SAFE",
        reason: "read-only git inspection",
        spec: { kind: "git", sub: sub as "status" | "diff" | "log" | "branch" },
      };
    }
    if (sub === "push") {
      if (
        rest.some((a) =>
          /^(-f|--force|--force-with-lease|--delete|-d|--mirror|:.*)$/i.test(a),
        )
      ) {
        return {
          class: "BLOCKED",
          reason: "force/delete pushes are never allowed",
        };
      }
      return {
        class: "REVIEW_REQUIRED",
        reason: "pushing publishes work: governed path with approval only",
      };
    }
    if (sub === "add" || sub === "commit") {
      return {
        class: "REVIEW_REQUIRED",
        reason: `git ${sub} runs only through the governed commit path`,
      };
    }
    return {
      class: "BLOCKED",
      reason: `"git ${sub}" is not allowed (history rewriting and destructive operations are blocked)`,
    };
  }

  if (program === "firebase") {
    return /^deploy$/i.test(args[0] ?? "")
      ? {
          class: "REVIEW_REQUIRED",
          reason: "deployment is a governed hand-off, never a shell command",
        }
      : {
          class: "BLOCKED",
          reason:
            "firebase CLI use other than the governed deploy is not allowed",
        };
  }

  return {
    class: "BLOCKED",
    reason: `"${program}" is not an allow-listed command`,
  };
}

function scriptCommand(
  script: string | undefined,
  extra: readonly string[],
  options: ClassifyOptions,
): CommandClassification {
  if (!script || !SCRIPT_NAME.test(script)) {
    return { class: "BLOCKED", reason: "invalid script name" };
  }
  if (extra.length > 0) {
    return { class: "BLOCKED", reason: "script arguments are not allowed" };
  }
  if (options.scripts && !options.scripts.includes(script)) {
    return {
      class: "BLOCKED",
      reason: `the workspace declares no "${script}" script`,
    };
  }
  const spec: CommandSpec = { kind: "script", script };
  return SAFE_SCRIPTS.has(script)
    ? { class: "SAFE", reason: "allow-listed validation script", spec }
    : {
        class: "REVIEW_REQUIRED",
        reason: `script "${script}" is not allow-listed: arbitrary scripts need review`,
        spec,
      };
}

export function displayOf(spec: CommandSpec): string {
  switch (spec.kind) {
    case "script":
      return `npm run ${spec.script}`;
    case "install":
      return "npm ci";
    case "git":
      return `git ${spec.sub}`;
  }
}

/** Timeout by command kind (milliseconds). */
export function timeoutFor(spec: CommandSpec): number {
  switch (spec.kind) {
    case "git":
      return 20_000;
    case "install":
      return 600_000;
    case "script":
      return spec.script === "build" ? 300_000 : 240_000;
  }
}
