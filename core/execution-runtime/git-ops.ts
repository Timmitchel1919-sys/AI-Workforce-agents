/**
 * Governed Git (Layer 5).
 *
 * Only fixed argument vectors run; there is no raw git, no flags from the
 * caller, no force, no history rewriting. Commit stages EXACTLY the named
 * files (never `git add .`), hooks are disabled, and push is fast-forward to
 * the workspace's own repository and branch only.
 */
import { spawn } from "node:child_process";
import type { GitState } from "../../contracts/execution-runtime.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
import { sanitizedEnv } from "./process-runner.js";

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitOps {
  state(): Promise<GitState>;
  /** Stage exactly `files` and commit them. Returns the new HEAD sha. */
  commit(
    files: readonly string[],
    message: string,
    identity: { name: string; email: string },
  ): Promise<{ sha: string }>;
  /** Fast-forward push of HEAD to `branch` of the repository the workspace is bound to. */
  push(
    branch: string,
    expectedRepository: string,
  ): Promise<"pushed" | "up_to_date">;
}

const NO_HOOKS = process.platform === "win32" ? "NUL" : "/dev/null";
const HARDENED = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.pager=cat",
  "-c",
  `core.hooksPath=${NO_HOOKS}`,
  "--no-pager",
];
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

function normalizeRepo(url: string): string {
  return url
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function sanitizeMessage(message: string): string {
  const cleaned = Array.from(message, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return maskSecrets(cleaned).slice(0, 200);
}

export class LocalGitOps implements GitOps {
  constructor(
    private readonly cwd: string,
    private readonly timeoutMs = 30_000,
  ) {}

  private run(args: readonly string[]): Promise<{ code: number; out: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", [...HARDENED, ...args], {
        cwd: this.cwd,
        env: sanitizedEnv(),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      const take = (b: Buffer): void => {
        if (out.length < 200_000) out += b.toString("utf8");
      };
      child.stdout?.on("data", take);
      child.stderr?.on("data", take);
      const timer = setTimeout(() => child.kill("SIGKILL"), this.timeoutMs);
      child.on("error", () => {
        clearTimeout(timer);
        reject(new GitError("git is not available on this host"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, out: maskSecrets(out) });
      });
    });
  }

  async state(): Promise<GitState> {
    const status = await this.run(["status", "--porcelain=v1", "-b"]);
    if (status.code !== 0) throw new GitError("not a git repository");
    const lines = status.out.split("\n").filter(Boolean);
    const header = lines[0]?.startsWith("## ") ? lines[0].slice(3) : "";
    const branch =
      header
        .split("...")[0]
        ?.replace(/^No commits yet on /, "")
        .trim() || undefined;
    const changedFiles = lines
      .slice(header ? 1 : 0)
      .map((l) =>
        l
          .slice(3)
          .replace(/^.* -> /, "")
          .trim(),
      )
      .filter(Boolean);
    const head = await this.run(["rev-parse", "HEAD"]);
    return {
      ...(branch ? { branch } : {}),
      ...(head.code === 0 ? { head: head.out.trim() } : {}),
      dirty: changedFiles.length > 0,
      changedFiles,
    };
  }

  async commit(
    files: readonly string[],
    message: string,
    identity: { name: string; email: string },
  ): Promise<{ sha: string }> {
    if (files.length === 0) throw new GitError("nothing to commit");
    const clean = sanitizeMessage(message);
    if (clean === "") throw new GitError("a commit message is required");
    const add = await this.run(["add", "--", ...files]);
    if (add.code !== 0) throw new GitError("staging failed");
    // The staged set must be exactly what was asked for.
    const staged = await this.run(["diff", "--cached", "--name-only"]);
    const stagedSet = new Set(
      staged.out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const wanted = new Set(files.map((f) => f.replace(/\\/g, "/")));
    for (const f of stagedSet) {
      if (!wanted.has(f)) {
        await this.run(["reset", "--quiet", "--", ...stagedSet]);
        throw new GitError(
          "unexpected files were staged; the commit was aborted",
        );
      }
    }
    const commit = await this.run([
      "-c",
      `user.name=${identity.name}`,
      "-c",
      `user.email=${identity.email}`,
      "commit",
      "--no-verify",
      "--no-gpg-sign",
      "-m",
      clean,
    ]);
    if (commit.code !== 0) throw new GitError("commit failed");
    const head = await this.run(["rev-parse", "HEAD"]);
    return { sha: head.out.trim() };
  }

  async push(
    branch: string,
    expectedRepository: string,
  ): Promise<"pushed" | "up_to_date"> {
    if (!BRANCH.test(branch) || branch.includes(".."))
      throw new GitError("invalid branch");
    const remote = await this.run(["remote", "get-url", "origin"]);
    if (remote.code !== 0) throw new GitError("no origin remote is configured");
    if (normalizeRepo(remote.out) !== normalizeRepo(expectedRepository)) {
      throw new GitError(
        "the origin remote is not the repository this workspace is bound to",
      );
    }
    const result = await this.run([
      "push",
      "origin",
      `HEAD:refs/heads/${branch}`,
    ]);
    if (result.code !== 0)
      throw new GitError("push was rejected (never forced)");
    return /Everything up-to-date/i.test(result.out) ? "up_to_date" : "pushed";
  }
}
