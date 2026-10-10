/**
 * EO-4.6 GovernedGitAdapter — the ONLY component that mutates a repository.
 *
 *   WRITE ≠ STAGE ≠ COMMIT ≠ PUSH · NO RAW GIT · NO FORCE PUSH
 *
 * Every git invocation is a FIXED, hardened argument template built here
 * (hooks, fsmonitor, pagers, external diff, credential helpers and every
 * transport except the configured remote's are disabled). Callers pass a
 * projectId and typed data (validated paths, a system-built message, a
 * validated branch) — never git arguments, a remote URL, a refspec or a
 * force flag. The repository and remote of a project come from trusted
 * composition. Push is fast-forward only (no `--force`, no lease override),
 * so a remote that moved is never overwritten. Credentials travel as an
 * HTTP header in the child's configuration environment — never in argv,
 * receipts or logs — and are redacted from output.
 */
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  ExecutionDeniedError,
  resolveWorkspacePath,
  validateBranchName,
  type GovernedGitPort,
  type StageSetFile,
} from "../../contracts/index.js";
import { runBoundedProcess } from "../execution/bounded-process-runner.js";

export interface GovernedRepositoryConfig {
  projectId: string;
  repositoryId: string;
  /** Host path of the working tree (trusted configuration only). */
  localPath: string;
  remote: {
    remoteId: string;
    /** https URL or an absolute local bare-repository path (tests/mirrors). */
    url: string;
  };
}

export interface GovernedGitAdapterOptions {
  gitPath: string;
  /** Directory used as HOME for git (no user/global configuration). */
  stateRoot: string;
  repositories: readonly GovernedRepositoryConfig[];
  timeoutMs?: number;
}

const NULL_DEVICE = "/dev/null";
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export class GovernedGitAdapter implements GovernedGitPort {
  private readonly repos = new Map<string, GovernedRepositoryConfig>();

  constructor(private readonly options: GovernedGitAdapterOptions) {
    if (!path.isAbsolute(options.gitPath)) {
      throw new Error("the trusted git executable must be an absolute path");
    }
    for (const repo of options.repositories) {
      const url = repo.remote.url;
      if (!/^https:\/\/[^\s@]+$/.test(url) && !path.isAbsolute(url)) {
        throw new Error(
          `remote for ${repo.projectId} must be https or an absolute local path`,
        );
      }
      if (/https:\/\/[^/]*@/.test(url)) {
        throw new Error("remote URLs must not embed credentials");
      }
      this.repos.set(repo.projectId, repo);
    }
  }

  private repo(projectId: string): GovernedRepositoryConfig {
    const repo = this.repos.get(projectId);
    if (!repo)
      throw new ExecutionDeniedError(
        "POLICY_DENIED",
        "no governed repository is configured for this project",
      );
    return repo;
  }

  remoteId(projectId: string): string {
    return this.repo(projectId).remote.remoteId;
  }

  private async git(
    repo: GovernedRepositoryConfig,
    args: readonly string[],
    credential?: string,
  ): Promise<{ text: string; exitCode: number | null }> {
    const root = await realpath(repo.localPath);
    const remoteScheme = repo.remote.url.startsWith("https://")
      ? "https"
      : "file";
    const env: Record<string, string> = {
      GIT_DIR: path.join(root, ".git"),
      GIT_WORK_TREE: root,
      GIT_CEILING_DIRECTORIES: path.dirname(root),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: NULL_DEVICE,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      HOME: this.options.stateRoot,
    };
    if (process.platform === "win32") {
      for (const name of ["SystemRoot", "windir"]) {
        const value = process.env[name];
        if (value) env[name] = value;
      }
    }
    if (credential) {
      // Header via config environment: never argv, never a URL.
      env.GIT_CONFIG_COUNT = "1";
      env.GIT_CONFIG_KEY_0 = "http.extraheader";
      env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${credential}`).toString("base64")}`;
    }
    const hardened = [
      "--no-pager",
      "-c",
      "core.fsmonitor=false",
      "-c",
      `core.hooksPath=${NULL_DEVICE}`,
      "-c",
      "core.pager=cat",
      "-c",
      "diff.external=",
      "-c",
      "credential.helper=",
      "-c",
      "protocol.allow=never",
      "-c",
      `protocol.${remoteScheme}.allow=always`,
      "-c",
      "color.ui=false",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.autocrlf=false",
    ];
    const run = await runBoundedProcess({
      executable: { executableId: "git", path: this.options.gitPath },
      argv: [...hardened, ...args],
      cwd: root,
      env,
      timeoutMs: this.options.timeoutMs ?? 60_000,
      maxOutputBytes: 1024 * 1024,
      signal: new AbortController().signal,
      knownSecrets: credential ? [credential] : [],
    });
    return {
      text: `${run.stdout.text}\n${run.stderr.text}`,
      exitCode: run.exitCode,
    };
  }

  async head(projectId: string): Promise<{ sha?: string; branch?: string }> {
    const repo = this.repo(projectId);
    const sha = (
      await this.git(repo, ["rev-parse", "--verify", "-q", "HEAD"])
    ).text
      .trim()
      .split(/\s+/)[0];
    const branch = (
      await this.git(repo, ["symbolic-ref", "-q", "--short", "HEAD"])
    ).text
      .trim()
      .split(/\s+/)[0];
    return {
      ...(sha && SHA.test(sha) ? { sha } : {}),
      ...(branch ? { branch } : {}),
    };
  }

  async commit(
    projectId: string,
    input: {
      files: readonly StageSetFile[];
      message: string;
      identity: { name: string; email: string };
      expectedHead?: string;
    },
  ): Promise<{ sha: string; parentSha?: string; files: readonly string[] }> {
    const repo = this.repo(projectId);
    if (input.files.length === 0 || input.files.length > 500) {
      throw new ExecutionDeniedError(
        "STAGING_CONFLICT",
        "a stage set needs 1-500 files",
      );
    }
    const paths = [
      ...new Set(
        input.files
          .flatMap((f) => [f.path, ...(f.fromPath ? [f.fromPath] : [])])
          .map((p) => resolveWorkspacePath(p)),
      ),
    ].sort();
    if (paths.some((p) => p === "." || p.split("/")[0] === ".git")) {
      throw new ExecutionDeniedError(
        "STAGING_CONFLICT",
        "repository internals are never staged",
      );
    }
    const before = await this.head(projectId);
    if (input.expectedHead && before.sha !== input.expectedHead) {
      throw new ExecutionDeniedError(
        "REVERIFICATION_REQUIRED",
        "the repository HEAD moved since the stage set was prepared",
      );
    }
    // Bounded staging: ONLY these paths (additions, edits and deletions).
    const add = await this.git(repo, ["add", "--all", "--", ...paths]);
    if (add.exitCode !== 0)
      throw new ExecutionDeniedError(
        "COMMIT_FAILED",
        "the stage set could not be staged",
      );
    // `--only` + pathspec: the commit contains exactly these paths, even if
    // other (pre-existing, unrelated) changes are staged in the index.
    const commit = await this.git(repo, [
      "-c",
      `user.name=${input.identity.name}`,
      "-c",
      `user.email=${input.identity.email}`,
      "commit",
      "--quiet",
      "--no-verify",
      "--only",
      "-m",
      input.message,
      "--",
      ...paths,
    ]);
    if (commit.exitCode !== 0)
      throw new ExecutionDeniedError("COMMIT_FAILED", "git refused the commit");
    const after = await this.head(projectId);
    if (!after.sha || after.sha === before.sha) {
      throw new ExecutionDeniedError("COMMIT_FAILED", "no commit was created");
    }
    const read = await this.readCommit(projectId, after.sha);
    return {
      sha: after.sha,
      ...(read?.parents[0] ? { parentSha: read.parents[0] } : {}),
      files: read?.files ?? [],
    };
  }

  async readCommit(
    projectId: string,
    sha: string,
  ): Promise<
    | { sha: string; parents: readonly string[]; files: readonly string[] }
    | undefined
  > {
    if (!SHA.test(sha)) return undefined;
    const repo = this.repo(projectId);
    const parents = await this.git(repo, [
      "rev-list",
      "--parents",
      "-n",
      "1",
      sha,
    ]);
    if (parents.exitCode !== 0) return undefined;
    const [found, ...rest] = parents.text.trim().split(/\s+/);
    if (found !== sha) return undefined;
    const files = await this.git(repo, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "--root",
      sha,
    ]);
    return {
      sha,
      parents: rest.filter((p) => SHA.test(p)),
      files: files.text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== ""),
    };
  }

  async remoteHead(
    projectId: string,
    branch: string,
    credential?: string,
  ): Promise<string | undefined> {
    const repo = this.repo(projectId);
    const ref = `refs/heads/${validateBranchName(branch)}`;
    const out = await this.git(
      repo,
      ["ls-remote", "--heads", "--", repo.remote.url, ref],
      credential,
    );
    if (out.exitCode !== 0)
      throw new ExecutionDeniedError(
        "PUSH_FAILED",
        "the remote could not be read",
      );
    const line = out.text.split(/\r?\n/).find((l) => l.trim().endsWith(ref));
    const sha = line?.split(/\s+/)[0];
    return sha && SHA.test(sha) ? sha : undefined;
  }

  async push(
    projectId: string,
    input: { branch: string; commitSha: string; credential?: string },
  ): Promise<"pushed" | "up_to_date"> {
    const repo = this.repo(projectId);
    if (!SHA.test(input.commitSha))
      throw new ExecutionDeniedError("PUSH_FAILED", "invalid commit");
    const ref = `refs/heads/${validateBranchName(input.branch)}`;
    // Fast-forward only: no --force, no +refspec, no --force-with-lease.
    const out = await this.git(
      repo,
      [
        "push",
        "--porcelain",
        "--no-verify",
        "--",
        repo.remote.url,
        `${input.commitSha}:${ref}`,
      ],
      input.credential,
    );
    if (out.exitCode !== 0) {
      if (/rejected|non-fast-forward|fetch first/i.test(out.text)) {
        throw new ExecutionDeniedError(
          "REMOTE_CHANGED",
          "the remote branch moved; nothing was overwritten",
        );
      }
      throw new ExecutionDeniedError(
        "PUSH_FAILED",
        "the push was refused by the remote",
      );
    }
    return /\[up to date\]/.test(out.text) ? "up_to_date" : "pushed";
  }
}
