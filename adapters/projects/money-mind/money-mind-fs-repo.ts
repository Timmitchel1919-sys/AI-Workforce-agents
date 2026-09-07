/**
 * Real, filesystem-backed `MoneyMindRepoPort`.
 *
 * This is the ONLY module in the AI Workforce repository allowed to import
 * `node:fs`, `node:path`, or `node:child_process` for Money Mind access. It
 * is never imported by `core/`, never imported by an agent, and never used in
 * a test — every test and the demonstration workflow use
 * `InMemoryMoneyMindRepo` instead.
 *
 * Command execution never accepts a raw string: it always spawns the fixed
 * binary `npm` with a two-element argv array (`["run", <allowlisted-script>]`)
 * built from a closed enum — there is no shell, no string interpolation, and
 * therefore no command-injection surface. The child process inherits a
 * minimal, explicit environment (never the Workforce process's full `env`,
 * which may hold unrelated provider credentials).
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  NotFoundError,
  ValidationError,
  type MoneyMindScript,
} from "../../../contracts/index.js";
import type {
  MoneyMindRepoPort,
  MoneyMindRunResult,
} from "./money-mind-repo-port.js";
import { resolveSafeRelativePath } from "./money-mind-path-policy.js";

export interface MoneyMindFsRepoOptions {
  /** Absolute path to a local Money Mind checkout. */
  repoPath: string;
  /** Per-call cap on bytes read from a single file. Default 256 KiB. */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;

function minimalChildEnv(): NodeJS.ProcessEnv {
  const source = process.env;
  const keep = [
    "PATH",
    "Path",
    "SystemRoot",
    "SystemDrive",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

export class NodeMoneyMindRepo implements MoneyMindRepoPort {
  private readonly repoRoot: string;
  private readonly maxFileBytes: number;

  constructor(options: MoneyMindFsRepoOptions) {
    if (!options.repoPath || options.repoPath.trim() === "") {
      throw new ValidationError("money-mind repository path must not be blank");
    }
    this.repoRoot = path.resolve(options.repoPath);
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  /** Resolve a validated relative path to an absolute path, re-checking containment. */
  private resolveAbsolute(relPath: string): string {
    const safe = resolveSafeRelativePath(relPath);
    const absolute = path.resolve(this.repoRoot, safe);
    const withSep = this.repoRoot.endsWith(path.sep)
      ? this.repoRoot
      : this.repoRoot + path.sep;
    if (absolute !== this.repoRoot && !absolute.startsWith(withSep)) {
      throw new ValidationError(
        `path escapes the money-mind repository root: "${relPath}"`,
      );
    }
    return absolute;
  }

  private async ensureRepoPresent(): Promise<void> {
    try {
      const stat = await fs.stat(this.repoRoot);
      if (!stat.isDirectory()) {
        throw new NotFoundError(
          `configured money-mind repository path is not a directory: ${this.repoRoot}`,
        );
      }
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new NotFoundError(
        `money-mind repository is not available at the configured path (set MONEY_MIND_REPO_PATH to a valid local checkout)`,
      );
    }
  }

  /** Never throws — a boolean probe, including when the repo root itself is absent. */
  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.stat(this.resolveAbsolute(relPath));
      return true;
    } catch {
      return false;
    }
  }

  async readTextFile(relPath: string): Promise<string> {
    await this.ensureRepoPresent();
    const absolute = this.resolveAbsolute(relPath);
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      throw new NotFoundError(
        `file not found in money-mind repository: ${relPath}`,
      );
    }
    if (!stat.isFile()) {
      throw new NotFoundError(
        `not a regular file in money-mind repository: ${relPath}`,
      );
    }
    const handle = await fs.open(absolute, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, this.maxFileBytes));
      await handle.read(buffer, 0, buffer.length, 0);
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  }

  async listDirectory(
    relPath: string,
  ): Promise<readonly { name: string; type: "file" | "dir" }[]> {
    await this.ensureRepoPresent();
    const absolute = this.resolveAbsolute(relPath);
    let entries;
    try {
      entries = await fs.readdir(absolute, { withFileTypes: true });
    } catch {
      throw new NotFoundError(
        `directory not found in money-mind repository: ${relPath}`,
      );
    }
    return entries
      .map((entry) => ({
        name: entry.name,
        type: (entry.isDirectory() ? "dir" : "file") as "file" | "dir",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async hasScript(script: MoneyMindScript): Promise<boolean> {
    await this.ensureRepoPresent();
    try {
      const raw = await this.readTextFile("package.json");
      const parsed: unknown = JSON.parse(raw);
      const scripts =
        parsed && typeof parsed === "object"
          ? (parsed as { scripts?: unknown }).scripts
          : undefined;
      return (
        !!scripts &&
        typeof scripts === "object" &&
        typeof (scripts as Record<string, unknown>)[script] === "string"
      );
    } catch {
      return false;
    }
  }

  async runScript(
    script: MoneyMindScript,
    timeoutMs: number,
  ): Promise<MoneyMindRunResult> {
    await this.ensureRepoPresent();
    const isWindows = process.platform === "win32";
    // On Windows, npm ships as `npm.cmd`, which cannot be spawned directly
    // without a shell. Rather than pass `shell: true` (which Node warns can
    // leave argv unescaped), spawn `cmd.exe` itself as the executable, with
    // `npm`/`run`/`script` as separate, ordinary argv elements — no string
    // concatenation, no shell-syntax reinterpretation. `script` reaching here
    // has already passed `validateMoneyMindRunTestsInput` against the closed
    // `MONEY_MIND_ALLOWED_SCRIPTS` enum, so it is provably alphabetic-only
    // regardless.
    const command = isWindows ? "cmd.exe" : "npm";
    const args = isWindows
      ? ["/d", "/s", "/c", "npm", "run", script]
      : ["run", script];
    const started = Date.now();
    return new Promise<MoneyMindRunResult>((resolve) => {
      execFile(
        command,
        args,
        {
          cwd: this.repoRoot,
          timeout: timeoutMs,
          windowsHide: true,
          env: minimalChildEnv(),
          maxBuffer: 4 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - started;
          const timedOut =
            !!error &&
            "killed" in error &&
            (error as { killed?: boolean }).killed === true;
          const exitCode =
            error && typeof (error as { code?: unknown }).code === "number"
              ? (error as { code: number }).code
              : error
                ? 1
                : 0;
          resolve({ exitCode, stdout, stderr, timedOut, durationMs });
        },
      );
    });
  }
}
