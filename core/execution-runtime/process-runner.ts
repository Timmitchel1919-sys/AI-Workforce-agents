/**
 * Process runner (Layer 5) — the only place a child process is created.
 *
 * Input is a structured `CommandSpec` (never a string for a shell). Output is
 * captured, size-bounded and secret-masked; every process has a timeout and
 * can be cancelled; the child gets a scrubbed environment.
 */
import { spawn } from "node:child_process";
import type { CommandSpec } from "../../contracts/execution-runtime.js";
import { RUNTIME_LIMITS } from "../../contracts/execution-runtime.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";

export interface ProcessRequest {
  spec: CommandSpec;
  /** Workspace root (already validated by the resolver). */
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  /** Called with masked chunks as they arrive (live output). */
  onChunk?: (chunk: string) => void;
}

export interface ProcessResult {
  exitCode?: number;
  timedOut: boolean;
  cancelled: boolean;
  /** Masked and bounded. */
  output: string;
  truncated: boolean;
  durationMs: number;
}

/** Port: any environment (local, Docker, cloud runner …) can implement it. */
export interface ProcessRunner {
  readonly id: string;
  run(request: ProcessRequest): Promise<ProcessResult>;
}

const ENV_ALLOW = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "ComSpec",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "TMPDIR",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramData",
  "LANG",
];
const SECRET_NAME =
  /(token|key|secret|password|passwd|credential|auth|private)/i;

/** A minimal environment: no credential-bearing variable ever reaches a child. */
export function sanitizedEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ENV_ALLOW) {
    const value = source[name];
    if (value !== undefined && !SECRET_NAME.test(name)) env[name] = value;
  }
  env["CI"] = "1";
  env["npm_config_update_notifier"] = "false";
  env["npm_config_audit"] = "false";
  env["npm_config_fund"] = "false";
  env["GIT_TERMINAL_PROMPT"] = "0";
  return env;
}

const SCRIPT = /^[a-z][a-z0-9:_-]{0,40}$/;

function argvFor(spec: CommandSpec): {
  command: string;
  args: string[];
  windowsLine?: string;
} {
  switch (spec.kind) {
    case "script": {
      if (!SCRIPT.test(spec.script)) throw new Error("invalid script name");
      return {
        command: "npm",
        args: ["run", spec.script],
        windowsLine: `npm run ${spec.script}`,
      };
    }
    case "install":
      return {
        command: "npm",
        args: ["ci", "--ignore-scripts"],
        windowsLine: "npm ci --ignore-scripts",
      };
    case "git": {
      const noHooks = process.platform === "win32" ? "NUL" : "/dev/null";
      const hardened = [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.pager=cat",
        "-c",
        `core.hooksPath=${noHooks}`,
        "--no-pager",
      ];
      const sub =
        spec.sub === "status"
          ? ["status", "--porcelain=v1", "-b"]
          : spec.sub === "diff"
            ? ["diff", "--no-ext-diff", "--no-textconv", "--stat"]
            : spec.sub === "log"
              ? ["log", "--oneline", "-n", "20"]
              : ["branch", "--list"];
      return { command: "git", args: [...hardened, ...sub] };
    }
  }
}

export class LocalProcessRunner implements ProcessRunner {
  readonly id = "local-process";

  run(request: ProcessRequest): Promise<ProcessResult> {
    const started = Date.now();
    const limit = Math.min(
      request.maxOutputBytes ?? RUNTIME_LIMITS.maxOutputBytes,
      1024 * 1024,
    );
    const { command, args, windowsLine } = argvFor(request.spec);
    const windows = process.platform === "win32";
    const child =
      windows && windowsLine !== undefined
        ? spawn(
            process.env["ComSpec"] ?? "cmd.exe",
            ["/d", "/s", "/c", windowsLine],
            {
              cwd: request.cwd,
              env: sanitizedEnv(),
              windowsHide: true,
              windowsVerbatimArguments: true,
              stdio: ["ignore", "pipe", "pipe"],
            },
          )
        : spawn(command, args, {
            cwd: request.cwd,
            env: sanitizedEnv(),
            windowsHide: true,
            shell: false,
            detached: !windows,
            stdio: ["ignore", "pipe", "pipe"],
          });

    return new Promise<ProcessResult>((resolve) => {
      let output = "";
      let bytes = 0;
      let truncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const kill = (): void => {
        if (child.pid === undefined) return;
        try {
          if (windows)
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
              windowsHide: true,
              stdio: "ignore",
            });
          else process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }
      };

      const finish = (exitCode: number | undefined): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        resolve({
          ...(exitCode !== undefined ? { exitCode } : {}),
          timedOut,
          cancelled,
          output,
          truncated,
          durationMs: Date.now() - started,
        });
      };

      const take = (buffer: Buffer): void => {
        if (truncated) return;
        const room = limit - bytes;
        const slice =
          buffer.length > room ? buffer.subarray(0, Math.max(room, 0)) : buffer;
        const text = maskSecrets(slice.toString("utf8"));
        bytes += slice.length;
        output += text;
        if (text) request.onChunk?.(text);
        if (buffer.length > room) {
          truncated = true;
          output += "\n… output truncated";
        }
      };

      child.stdout?.on("data", take);
      child.stderr?.on("data", take);
      child.on("error", (error) => {
        output += `\n${maskSecrets(error.message)}`;
        finish(undefined);
      });
      // 'close' fires after the stdio streams end, so all output is captured.
      child.on("close", (code) => finish(code ?? undefined));

      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, request.timeoutMs);

      const onAbort = (): void => {
        cancelled = true;
        kill();
      };
      if (request.signal?.aborted) onAbort();
      else request.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
