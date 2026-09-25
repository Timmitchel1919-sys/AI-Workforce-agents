/**
 * BoundedProcessRunner — EO-4.2's ONLY general process adapter, and it is
 * private to trusted sandbox providers (never exported to agents, the API or
 * the UI). It accepts:
 *
 *   - a TRUSTED executable: an absolute path resolved by server composition
 *     from an `executableId` (never a caller-supplied path),
 *   - a validated argument VECTOR (never shell program text),
 *   - a provider-owned working directory,
 *   - a COMPLETE, explicitly constructed environment (nothing inherited: no
 *     OPENAI_API_KEY, Firebase or cloud credentials leak through by default),
 *   - a finite timeout, an output cap and an AbortSignal.
 *
 * It spawns with `shell: false` (no `bash -c`, `cmd /c`, `powershell
 * -Command`), bounds stdout/stderr (explicit truncation), redacts well-known
 * secret shapes, and terminates the whole process tree on timeout or cancel:
 * POSIX via the process group, Windows via the system `taskkill /T /F`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import {
  KNOWN_SECRET_VALUE_PATTERN,
  ValidationError,
  type BoundedOutput,
} from "../../contracts/index.js";

export interface TrustedExecutable {
  executableId: string;
  /** Absolute path, resolved by trusted composition. */
  path: string;
}

export interface BoundedProcessSpec {
  executable: TrustedExecutable;
  argv: readonly string[];
  cwd: string;
  /** The child's ENTIRE environment. */
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
  knownSecrets?: readonly string[];
}

export interface BoundedProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  stdout: BoundedOutput;
  stderr: BoundedOutput;
  durationMs: number;
  redactions: number;
}

const REDACTED = "[redacted]";
const SECRET_SHAPES = new RegExp(KNOWN_SECRET_VALUE_PATTERN.source, "g");

function finalize(
  captured: Buffer,
  totalBytes: number,
  maxBytes: number,
  knownSecrets: readonly string[],
): BoundedOutput & { redactions: number } {
  let redactions = 0;
  let text = captured.subarray(0, maxBytes).toString("utf8");
  if (text.endsWith("\uFFFD")) text = text.slice(0, -1);
  text = text.replace(SECRET_SHAPES, () => {
    redactions += 1;
    return REDACTED;
  });
  for (const secret of knownSecrets) {
    if (secret.length < 4) continue;
    const parts = text.split(secret);
    redactions += parts.length - 1;
    text = parts.join(REDACTED);
  }
  return {
    text,
    truncated: totalBytes > maxBytes,
    originalBytes: totalBytes,
    redactions,
  };
}

/** Terminate the child and its descendants where the platform allows it. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const root = process.env.SystemRoot ?? "C:\\Windows";
    const taskkill = spawn(
      path.join(root, "System32", "taskkill.exe"),
      ["/pid", String(child.pid), "/T", "/F"],
      { shell: false, windowsHide: true, stdio: "ignore" },
    );
    taskkill.on("error", () => child.kill("SIGKILL"));
    return;
  }
  try {
    // Negative pid: the whole process group created by `detached: true`.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export function validateBoundedProcessSpec(spec: BoundedProcessSpec): void {
  if (!path.isAbsolute(spec.executable.path)) {
    throw new ValidationError(
      "executable path must be absolute (trusted composition)",
    );
  }
  if (!path.isAbsolute(spec.cwd)) {
    throw new ValidationError(
      "working directory must be provider-owned and absolute",
    );
  }
  for (const arg of spec.argv) {
    if (typeof arg !== "string" || arg.includes("\u0000")) {
      throw new ValidationError("arguments must be NUL-free strings");
    }
  }
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs <= 0) {
    throw new ValidationError("a finite timeout is required");
  }
  if (!Number.isInteger(spec.maxOutputBytes) || spec.maxOutputBytes <= 0) {
    throw new ValidationError("an output limit is required");
  }
}

export function runBoundedProcess(
  spec: BoundedProcessSpec,
): Promise<BoundedProcessResult> {
  validateBoundedProcessSpec(spec);
  const started = Date.now();
  return new Promise((resolve) => {
    const cap = spec.maxOutputBytes;
    const out = { buf: Buffer.alloc(0), total: 0 };
    const err = { buf: Buffer.alloc(0), total: 0 };
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const child = spawn(spec.executable.path, [...spec.argv], {
      cwd: spec.cwd,
      env: { ...spec.env },
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect =
      (target: { buf: Buffer; total: number }) => (chunk: Buffer) => {
        target.total += chunk.length;
        if (target.buf.length <= cap) {
          target.buf = Buffer.concat([target.buf, chunk]).subarray(0, cap + 1);
        }
      };
    child.stdout?.on("data", collect(out));
    child.stderr?.on("data", collect(err));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, spec.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      killTree(child);
    };
    if (spec.signal.aborted) onAbort();
    else spec.signal.addEventListener("abort", onAbort, { once: true });

    const done = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      spec.signal.removeEventListener("abort", onAbort);
      const secrets = spec.knownSecrets ?? [];
      const stdout = finalize(out.buf, out.total, cap, secrets);
      const stderr = finalize(err.buf, err.total, cap, secrets);
      resolve({
        exitCode,
        timedOut,
        cancelled,
        stdout: {
          text: stdout.text,
          truncated: stdout.truncated,
          originalBytes: stdout.originalBytes,
        },
        stderr: {
          text: stderr.text,
          truncated: stderr.truncated,
          originalBytes: stderr.originalBytes,
        },
        durationMs: Date.now() - started,
        redactions: stdout.redactions + stderr.redactions,
      });
    };
    // A spawn failure (missing executable) is a normalized failure, not a throw.
    child.on("error", () => done(null));
    child.on("close", (code) => done(code));
  });
}
