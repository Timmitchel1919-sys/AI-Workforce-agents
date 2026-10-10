/**
 * WorkspaceRepositorySandbox — EO-4.3 trusted workspace + repository adapter.
 *
 * WORKSPACE ≠ HOST FILESYSTEM. Every operation is confined to the root of
 * the project's CONFIGURED repository (trusted composition), addressed only
 * by workspace-relative paths:
 *
 *   canonicalize (contracts/workspace-paths) → join under root → realpath
 *   of the target (or nearest existing ancestor) must stay inside the root
 *   (symlink / junction / reparse-point escapes are refused) → policy class
 *   (.git internal, secret, generated, protected) → capability + mode →
 *   size limits → optimistic hash / baseline conflict checks → atomic write.
 *
 * Repository reads run a trusted `git` with FIXED hardened arguments, an
 * explicit GIT_DIR / GIT_WORK_TREE / ceiling, system/global config disabled
 * and no terminal prompt. There is no stage, commit, branch, fetch or push.
 *
 * Each session gets a ChangeSet (metadata only) and session-owned backups so
 * rollback reverts ONLY its own mutations. Write sessions hold a bounded,
 * expiring lease per repository root; cleanup fails closed.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_WORKSPACE_FILE_POLICY,
  ExecutionDeniedError,
  KNOWN_SECRET_VALUE_PATTERN,
  REQUIRED_LIMIT_KEYS,
  assertRealPathWithinRoot,
  canTransitionWorkspace,
  classifyWorkspacePath,
  resolveWorkspacePath,
  validateRepositoryReference,
  type ArtifactReference,
  type ChangeSet,
  type ExecutionCapability,
  type ExecutionErrorCode,
  type ExecutionWorkspace,
  type FileChangeEvidence,
  type ManagedWorkspaceView,
  type RepositoryReference,
  type RollbackReport,
  type SandboxHandle,
  type SandboxInvocationOutcome,
  type SandboxInvokeOptions,
  type SandboxProvider,
  type SandboxProviderCapabilities,
  type SandboxSpec,
  type SourceFingerprint,
  type StructuredInvocation,
  type WorkspaceCleanupReport,
  type WorkspaceControl,
  type WorkspaceFilePolicy,
  type WorkspaceState,
} from "../../contracts/index.js";
import { runBoundedProcess } from "../execution/bounded-process-runner.js";

export interface WorkspaceEvent {
  action: string;
  projectId: string;
  data: Record<string, unknown>;
}

export interface WorkspaceRepositorySandboxOptions {
  /** Trusted repository configuration (one per project). */
  repositories: readonly RepositoryReference[];
  environmentInstanceIds: readonly string[];
  /** Absolute path of the trusted git executable (composition time). */
  gitPath?: string;
  /** Adapter-owned directory for markers + session backups. */
  stateRoot: string;
  policy?: WorkspaceFilePolicy;
  projectPolicies?: Readonly<Record<string, WorkspaceFilePolicy>>;
  clock?: () => string;
  onEvent?: (event: WorkspaceEvent) => void;
  maxConcurrentInvocations?: number;
}

interface Original {
  /** undefined = the path did not exist before the session touched it. */
  hash?: string;
  backupFile?: string;
}

interface WorkspaceRecord {
  view: ManagedWorkspaceView;
  root: string;
  statePath: string;
  capabilities: Set<ExecutionCapability>;
  policy: WorkspaceFilePolicy;
  baseline: Set<string>;
  originals: Map<string, Original>;
  current: Map<string, string | undefined>;
  movedFrom: Map<string, string>;
  /** Cumulative size delta per session-touched path. */
  sizes: Map<string, number>;
  changeSet: ChangeSet;
  gitDir?: string;
}

interface OperationResult {
  data: Record<string, unknown>;
  changes?: FileChangeEvidence[];
  exitClass?: SandboxInvocationOutcome["exitClass"];
}

const MARKER = ".aiw-workspace.json";
const NULL_DEVICE = "/dev/null";

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function deny(code: ExecutionErrorCode, detail: string): never {
  throw new ExecutionDeniedError(code, detail);
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}

function nowIso(): string {
  return new Date().toISOString();
}

export class WorkspaceRepositorySandbox
  implements SandboxProvider, WorkspaceControl
{
  readonly providerId = "workspace-repository";
  readonly kind = "local_restricted_process" as const;
  readonly capabilities: SandboxProviderCapabilities;
  private readonly records = new Map<string, WorkspaceRecord>();
  private readonly handles = new Map<string, string>();
  /** Exclusive write leases per repository root. */
  private readonly leases = new Map<
    string,
    { workspaceId: string; sessionId: string; expiresAt: string }
  >();
  private readonly repositories = new Map<string, RepositoryReference>();
  private readonly clock: () => string;

  constructor(private readonly options: WorkspaceRepositorySandboxOptions) {
    for (const repo of options.repositories) {
      validateRepositoryReference(repo);
      if (repo.localPath && !path.isAbsolute(repo.localPath)) {
        throw new Error(
          `repository ${repo.repositoryId} localPath must be absolute`,
        );
      }
      this.repositories.set(repo.projectId, repo);
    }
    if (!path.isAbsolute(options.stateRoot))
      throw new Error("stateRoot must be absolute");
    if (options.gitPath && !path.isAbsolute(options.gitPath))
      throw new Error("gitPath must be absolute");
    this.clock = options.clock ?? nowIso;
    this.capabilities = {
      // Session budget + tool-call count are enforced by the ExecutionManager;
      // git reads are killed at the operation timeout; file operations are
      // bounded by size limits; no artifacts are produced.
      enforcedLimits: [...REQUIRED_LIMIT_KEYS],
      networkModes: ["deny_all"],
      // No network: in-process file I/O, and git with protocol.allow=never.
      networkIsolation: true,
      // Adapter-confined: realpath-checked paths under the configured root.
      filesystemIsolation: true,
      supportsKill: true,
      maxConcurrentInvocations: options.maxConcurrentInvocations ?? 4,
      executables: ["workspace", "git"],
    };
  }

  isAvailableFor(environmentInstanceId: string): boolean {
    return this.options.environmentInstanceIds.includes(environmentInstanceId);
  }

  /* -------------------------------------------------------------- */
  /* Lifecycle                                                      */
  /* -------------------------------------------------------------- */

  private emit(
    projectId: string,
    action: string,
    data: Record<string, unknown>,
  ): void {
    this.options.onEvent?.({ action, projectId, data });
  }

  private setState(record: WorkspaceRecord, to: WorkspaceState): void {
    if (record.view.state === to) return;
    if (!canTransitionWorkspace(record.view.state, to)) {
      deny(
        "SANDBOX_FAILURE",
        `workspace cannot move from ${record.view.state} to ${to}`,
      );
    }
    record.view = { ...record.view, state: to };
  }

  async prepareWorkspace(spec: SandboxSpec): Promise<ExecutionWorkspace> {
    await this.start(spec);
    return { ...spec.workspace, status: "prepared" };
  }

  async start(spec: SandboxSpec): Promise<SandboxHandle> {
    const workspaceId = spec.workspace.workspaceId;
    let record = this.records.get(workspaceId);
    if (record) {
      if (
        record.view.sessionId !== spec.sessionId ||
        record.view.projectId !== spec.projectId
      ) {
        deny("WORKSPACE_VIOLATION", "the workspace belongs to another session");
      }
      if (record.view.state === "closed" || record.view.state === "failed") {
        deny("SANDBOX_UNAVAILABLE", `the workspace is ${record.view.state}`);
      }
      if (record.view.mode === "read_write") this.acquireLease(record, spec);
    } else {
      record = await this.create(spec);
    }
    const sandboxId = `sbx_${randomUUID()}`;
    this.handles.set(sandboxId, workspaceId);
    return {
      sandboxId,
      providerId: this.providerId,
      sessionId: spec.sessionId,
    };
  }

  /** Throws when another live write session holds the root's lease. */
  private assertLeaseFree(root: string, workspaceId: string): void {
    const held = this.leases.get(root);
    if (
      held &&
      held.workspaceId !== workspaceId &&
      Date.parse(held.expiresAt) > Date.parse(this.clock())
    ) {
      deny(
        "WORKSPACE_CONFLICT",
        "the project workspace is leased by another write session",
      );
    }
  }

  private acquireLease(record: WorkspaceRecord, spec: SandboxSpec): void {
    const now = this.clock();
    this.assertLeaseFree(record.root, record.view.workspaceId);
    const held = this.leases.get(record.root);
    if (held && held.workspaceId !== record.view.workspaceId) {
      // Expired lease of a crashed/abandoned session: reclaim (bounded).
      const stale = this.records.get(held.workspaceId);
      if (stale && stale.view.state !== "closed")
        stale.view = { ...stale.view, state: "failed" };
      this.emit(record.view.projectId, "workspace_lease_reclaimed", {
        workspaceId: held.workspaceId,
      });
    }
    const expiresAt = new Date(
      Date.parse(now) + spec.limits.sessionTimeoutMs,
    ).toISOString();
    this.leases.set(record.root, {
      workspaceId: record.view.workspaceId,
      sessionId: spec.sessionId,
      expiresAt,
    });
    record.view = { ...record.view, leaseExpiresAt: expiresAt };
  }

  private async create(spec: SandboxSpec): Promise<WorkspaceRecord> {
    const repo = this.repositories.get(spec.projectId);
    if (!repo)
      deny(
        "SANDBOX_UNAVAILABLE",
        "no repository is configured for this project",
      );
    if (!repo.localPath) {
      deny(
        "SANDBOX_UNAVAILABLE",
        "remote repository acquisition requires a secret-broker credential handle (not available in EO-4.3)",
      );
    }
    const root = await realpath(repo.localPath).catch(() =>
      deny("SANDBOX_UNAVAILABLE", "the repository path is unavailable"),
    );
    if (!(await stat(root)).isDirectory())
      deny("SANDBOX_UNAVAILABLE", "the repository path is not a directory");
    const stateRoot = await realpath(this.options.stateRoot).catch(() =>
      deny("SANDBOX_UNAVAILABLE", "the workspace state root is unavailable"),
    );
    // Refuse a busy workspace BEFORE creating any state.
    if (spec.workspace.mode === "read_write")
      this.assertLeaseFree(root, spec.workspace.workspaceId);
    const statePath = path.join(stateRoot, spec.workspace.workspaceId);
    assertRealPathWithinRoot(
      stateRoot,
      statePath,
      process.platform === "win32" ? "win32" : "posix",
    );
    // The state root must never be inside the workspace (or vice versa).
    for (const [a, b] of [
      [root, stateRoot],
      [stateRoot, root],
    ] as const) {
      try {
        assertRealPathWithinRoot(
          a,
          b,
          process.platform === "win32" ? "win32" : "posix",
        );
        deny("SANDBOX_UNAVAILABLE", "state root and workspace root overlap");
      } catch (error) {
        if (
          !(error instanceof ExecutionDeniedError) ||
          error.code !== "WORKSPACE_VIOLATION"
        )
          throw error;
      }
    }
    await mkdir(path.join(statePath, "backups"), { recursive: true });
    await writeFile(
      path.join(statePath, MARKER),
      JSON.stringify({
        workspaceId: spec.workspace.workspaceId,
        projectId: spec.projectId,
      }),
      { flag: "wx" },
    ).catch(() =>
      deny("SANDBOX_FAILURE", "the workspace state directory already exists"),
    );

    const at = this.clock();
    const policy =
      this.options.projectPolicies?.[spec.projectId] ??
      this.options.policy ??
      DEFAULT_WORKSPACE_FILE_POLICY;
    const gitDir = path.join(root, ".git");
    const hasGit = await stat(gitDir)
      .then((s) => s.isDirectory())
      .catch(() => false);
    const record: WorkspaceRecord = {
      view: {
        workspaceId: spec.workspace.workspaceId,
        projectId: spec.projectId,
        sessionId: spec.sessionId,
        repositoryId: repo.repositoryId,
        rootRef: spec.workspace.rootRef,
        mode: spec.workspace.mode,
        state: "preparing",
        createdAt: at,
      },
      root,
      statePath,
      capabilities: new Set(spec.grants.map((g) => g.capability)),
      policy,
      baseline: new Set(),
      originals: new Map(),
      current: new Map(),
      movedFrom: new Map(),
      sizes: new Map(),
      changeSet: {
        changeSetId: `chg_${randomUUID()}`,
        projectId: spec.projectId,
        workspaceId: spec.workspace.workspaceId,
        sessionId: spec.sessionId,
        baseline: [],
        entries: [],
        status: "open",
        updatedAt: at,
      },
      ...(hasGit ? { gitDir } : {}),
    };
    this.records.set(record.view.workspaceId, record);
    try {
      if (record.view.mode === "read_write") this.acquireLease(record, spec);
      // Baseline: pre-existing changes are recorded and protected.
      if (hasGit && this.options.gitPath) {
        const status = await this.git(
          record,
          ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          30_000,
          4 * 1024 * 1024,
        );
        for (const entry of parseStatus(status.text).entries) {
          record.baseline.add(entry.path);
          if (entry.fromPath) record.baseline.add(entry.fromPath);
        }
        const head = await this.git(
          record,
          ["rev-parse", "HEAD"],
          30_000,
          1024,
        ).catch(() => undefined);
        const revision = head?.exitCode === 0 ? head.text.trim() : undefined;
        if (revision && /^[0-9a-f]{40,64}$/.test(revision)) {
          record.view = { ...record.view, baseRevision: revision };
          record.changeSet = { ...record.changeSet, baseRevision: revision };
        }
      }
      record.changeSet = {
        ...record.changeSet,
        baseline: [...record.baseline].sort(),
      };
      this.setState(record, "ready");
    } catch (error) {
      // Undo only what THIS start created; never another session's lease.
      if (
        this.leases.get(record.root)?.workspaceId === record.view.workspaceId
      ) {
        this.leases.delete(record.root);
      }
      this.records.delete(record.view.workspaceId);
      await rm(statePath, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
    this.emit(spec.projectId, "workspace_created", {
      workspaceId: record.view.workspaceId,
      execution: spec.sessionId,
      repositoryId: repo.repositoryId,
      mode: record.view.mode,
      baselineChanges: record.baseline.size,
      changeSetId: record.changeSet.changeSetId,
    });
    return record;
  }

  async terminate(): Promise<void> {
    // Termination is driven by the invocation AbortSignal (git process kill).
  }

  async collectOutputs(): Promise<readonly ArtifactReference[]> {
    return [];
  }

  async cleanup(handle: SandboxHandle): Promise<void> {
    // Per-invocation handle only; the workspace lives until `release`.
    this.handles.delete(handle.sandboxId);
  }

  /* -------------------------------------------------------------- */
  /* Invocation                                                     */
  /* -------------------------------------------------------------- */

  async invoke(
    handle: SandboxHandle,
    invocation: StructuredInvocation,
    options: SandboxInvokeOptions,
  ): Promise<SandboxInvocationOutcome> {
    const started = Date.now();
    const workspaceId = this.handles.get(handle.sandboxId);
    const record = workspaceId ? this.records.get(workspaceId) : undefined;
    const outcome = (
      exitClass: SandboxInvocationOutcome["exitClass"],
      text: string,
      extra: Partial<SandboxInvocationOutcome> = {},
    ): SandboxInvocationOutcome => ({
      exitClass,
      exitCode: exitClass === "success" ? 0 : null,
      stdout: {
        text,
        truncated: false,
        originalBytes: Buffer.byteLength(text),
      },
      stderr: { text: "", truncated: false, originalBytes: 0 },
      durationMs: Date.now() - started,
      redactions: 0,
      ...extra,
    });
    if (!record || record.view.sessionId !== handle.sessionId) {
      return outcome("denied", "", {
        denial: {
          code: "WORKSPACE_VIOLATION",
          detail: "unknown workspace handle",
        },
      });
    }
    this.setState(record, "in_use");
    try {
      const result =
        invocation.executableId === "workspace"
          ? await this.fileOperation(
              record,
              invocation.operationId,
              invocation.input ?? {},
            )
          : invocation.executableId === "git"
            ? await this.repositoryOperation(record, invocation, options)
            : deny(
                "TOOL_NOT_ALLOWED",
                "this sandbox runs only workspace and repository operations",
              );
      const text = JSON.stringify(result.data);
      if (Buffer.byteLength(text) > options.maxOutputBytes) {
        deny("RESOURCE_LIMIT", "the operation result exceeds the output limit");
      }
      return outcome(result.exitClass ?? "success", text, {
        ...(result.exitClass === "tool_failure" ? { exitCode: 1 } : {}),
        ...(result.changes
          ? {
              changes: result.changes,
              changeSetId: record.changeSet.changeSetId,
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof ExecutionDeniedError) {
        if (error.code === "POLICY_DENIED") {
          this.emit(record.view.projectId, "protected_operation_denied", {
            workspaceId: record.view.workspaceId,
            operationId: invocation.operationId,
            detail: error.message,
          });
        }
        return outcome("denied", "", {
          denial: { code: error.code, detail: error.message },
        });
      }
      return outcome("tool_failure", "", {});
    } finally {
      if (record.view.state === "in_use") {
        this.setState(
          record,
          record.changeSet.entries.length > 0 ? "dirty" : "ready",
        );
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* Paths                                                          */
  /* -------------------------------------------------------------- */

  private platform(): "win32" | "posix" {
    return process.platform === "win32" ? "win32" : "posix";
  }

  private resolve(
    record: WorkspaceRecord,
    requested: unknown,
  ): { rel: string; abs: string } {
    const rel = resolveWorkspacePath(requested);
    const abs =
      rel === "." ? record.root : path.join(record.root, ...rel.split("/"));
    return { rel, abs };
  }

  /** realpath of `abs` (or of its nearest existing ancestor) stays inside the root. */
  private async assertContained(
    record: WorkspaceRecord,
    abs: string,
  ): Promise<void> {
    let probe = abs;
    for (;;) {
      try {
        const real = await realpath(probe);
        assertRealPathWithinRoot(record.root, real, this.platform());
        return;
      } catch (error) {
        if (error instanceof ExecutionDeniedError) throw error;
        const parent = path.dirname(probe);
        if (parent === probe)
          deny(
            "WORKSPACE_VIOLATION",
            "path cannot be resolved inside the workspace",
          );
        probe = parent;
      }
    }
  }

  private classify(
    record: WorkspaceRecord,
    rel: string,
    access: "read" | "write",
  ): "normal" | "protected" {
    const cls = classifyWorkspacePath(rel, record.policy);
    if (cls === "internal")
      deny("POLICY_DENIED", "repository internals (.git) are not accessible");
    if (cls === "secret")
      deny(
        "POLICY_DENIED",
        "protected credential/secret file: content is never exposed",
      );
    if (access === "write") {
      if (cls === "generated")
        deny(
          "POLICY_DENIED",
          "generated/build output is not source; use artifact management",
        );
      if (
        cls === "protected" &&
        !record.capabilities.has("filesystem.write.protected")
      ) {
        deny(
          "POLICY_DENIED",
          "protected path requires the filesystem.write.protected capability",
        );
      }
    }
    return cls === "protected" ? "protected" : "normal";
  }

  private requireWrite(
    record: WorkspaceRecord,
    capability: ExecutionCapability,
  ): void {
    if (record.view.mode !== "read_write")
      deny("POLICY_DENIED", "this workspace session is read-only");
    if (!record.capabilities.has(capability)) {
      deny("CAPABILITY_NOT_GRANTED", `the session lacks ${capability}`);
    }
  }

  private async currentHash(abs: string): Promise<string | undefined> {
    const info = await lstat(abs).catch(() => undefined);
    if (!info) return undefined;
    if (!info.isFile())
      deny(
        "POLICY_DENIED",
        "only regular files can be modified (no symlinks or directories)",
      );
    return sha256(await readFile(abs));
  }

  private guardBaseline(record: WorkspaceRecord, rel: string): void {
    if (record.baseline.has(rel) && !record.originals.has(rel)) {
      deny(
        "WORKSPACE_CONFLICT",
        "the file has pre-existing uncommitted changes and is protected from overwrite",
      );
    }
  }

  private async remember(
    record: WorkspaceRecord,
    rel: string,
    abs: string,
  ): Promise<void> {
    if (record.originals.has(rel)) return;
    if (record.originals.size >= record.policy.maxChangedFiles) {
      deny(
        "RESOURCE_LIMIT",
        "the change set reached its maximum number of files",
      );
    }
    const info = await lstat(abs).catch(() => undefined);
    if (!info) {
      record.originals.set(rel, {});
      return;
    }
    const content = await readFile(abs);
    const backupFile = path.join(record.statePath, "backups", sha256(rel));
    await writeFile(backupFile, content);
    record.originals.set(rel, { hash: sha256(content), backupFile });
  }

  /** Write via a temp file in the target directory, then replace. */
  private async atomicWrite(
    record: WorkspaceRecord,
    abs: string,
    content: Buffer | string,
  ): Promise<void> {
    const dir = path.dirname(abs);
    await this.assertContained(record, dir);
    await mkdir(dir, { recursive: true });
    await this.assertContained(record, dir);
    const temp = path.join(dir, `.aiw-tmp-${randomUUID()}`);
    try {
      await writeFile(temp, content, { flag: "wx" });
      await rename(temp, abs);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    await this.assertContained(record, abs);
  }

  private recompute(record: WorkspaceRecord): FileChangeEvidence[] {
    const entries: FileChangeEvidence[] = [];
    for (const [rel, original] of record.originals) {
      const now = record.current.get(rel);
      const risk =
        classifyWorkspacePath(rel, record.policy) === "protected"
          ? "protected"
          : "normal";
      if (original.hash === undefined && now !== undefined) {
        const from = record.movedFrom.get(rel);
        if (
          from &&
          record.originals.get(from)?.hash === now &&
          record.current.get(from) === undefined
        ) {
          entries.push({
            path: rel,
            change: "renamed",
            fromPath: from,
            beforeHash: now,
            afterHash: now,
            sizeDelta: 0,
            risk,
          });
        } else {
          entries.push({
            path: rel,
            change: "created",
            afterHash: now,
            sizeDelta: 0,
            risk,
          });
        }
      } else if (original.hash !== undefined && now === undefined) {
        const renamedTo = [...record.movedFrom].find(
          ([to, from]) =>
            from === rel && record.current.get(to) === original.hash,
        )?.[0];
        if (!renamedTo)
          entries.push({
            path: rel,
            change: "deleted",
            beforeHash: original.hash,
            sizeDelta: 0,
            risk,
          });
      } else if (
        original.hash !== undefined &&
        now !== undefined &&
        original.hash !== now
      ) {
        entries.push({
          path: rel,
          change: "modified",
          beforeHash: original.hash,
          afterHash: now,
          sizeDelta: 0,
          risk,
        });
      }
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  private updateChangeSet(
    record: WorkspaceRecord,
    deltas: Record<string, number>,
  ): FileChangeEvidence[] {
    for (const [rel, delta] of Object.entries(deltas)) {
      record.sizes.set(rel, (record.sizes.get(rel) ?? 0) + delta);
    }
    const merged = this.recompute(record).map((e) => ({
      ...e,
      sizeDelta: record.sizes.get(e.path) ?? 0,
    }));
    record.changeSet = {
      ...record.changeSet,
      entries: merged,
      updatedAt: this.clock(),
    };
    this.emit(record.view.projectId, "changeset_updated", {
      changeSetId: record.changeSet.changeSetId,
      workspaceId: record.view.workspaceId,
      files: merged.length,
    });
    return merged;
  }

  /* -------------------------------------------------------------- */
  /* File operations                                                */
  /* -------------------------------------------------------------- */

  private async fileOperation(
    record: WorkspaceRecord,
    operationId: string,
    input: Readonly<Record<string, string | number>>,
  ): Promise<OperationResult> {
    const policy = record.policy;
    switch (operationId) {
      case "workspace.file.read": {
        const { rel, abs } = this.resolve(record, input.path);
        this.classify(record, rel, "read");
        await this.assertContained(record, abs);
        const info = await stat(abs).catch(() =>
          deny("INVALID_TOOL_INPUT", "file not found"),
        );
        if (!info.isFile()) deny("INVALID_TOOL_INPUT", "not a regular file");
        if (info.size > policy.maxReadBytes)
          deny(
            "RESOURCE_LIMIT",
            `file exceeds the ${policy.maxReadBytes}-byte read limit`,
          );
        const content = await readFile(abs);
        const hash = sha256(content);
        if (isBinary(content))
          return {
            data: { path: rel, binary: true, size: info.size, sha256: hash },
          };
        return {
          data: {
            path: rel,
            size: info.size,
            sha256: hash,
            content: content.toString("utf8"),
          },
        };
      }
      case "workspace.file.stat": {
        const { rel, abs } = this.resolve(record, input.path);
        const cls = classifyWorkspacePath(rel, policy);
        if (cls === "internal")
          deny(
            "POLICY_DENIED",
            "repository internals (.git) are not accessible",
          );
        await this.assertContained(record, abs);
        const info = await lstat(abs).catch(() =>
          deny("INVALID_TOOL_INPUT", "path not found"),
        );
        const type = info.isSymbolicLink()
          ? "symlink"
          : info.isDirectory()
            ? "directory"
            : "file";
        const hash =
          type === "file" &&
          cls !== "secret" &&
          info.size <= policy.maxSearchFileBytes
            ? sha256(await readFile(abs))
            : undefined;
        return {
          data: {
            path: rel,
            type,
            size: info.size,
            class: cls,
            ...(hash ? { sha256: hash } : {}),
          },
        };
      }
      case "workspace.file.list": {
        const { rel, abs } = this.resolve(record, input.path ?? ".");
        if (classifyWorkspacePath(rel, policy) === "internal")
          deny(
            "POLICY_DENIED",
            "repository internals (.git) are not accessible",
          );
        await this.assertContained(record, abs);
        const entries = await readdir(abs, { withFileTypes: true }).catch(() =>
          deny("INVALID_TOOL_INPUT", "directory not found"),
        );
        const visible = entries
          .filter((e) => !(rel === "." && e.name === ".git"))
          .sort((a, b) => a.name.localeCompare(b.name));
        const offset = typeof input.offset === "number" ? input.offset : 0;
        const limit = Math.min(
          typeof input.limit === "number" ? input.limit : policy.maxListEntries,
          policy.maxListEntries,
        );
        const page = visible.slice(offset, offset + limit).map((e) => {
          const childRel = rel === "." ? e.name : `${rel}/${e.name}`;
          return {
            name: e.name,
            path: childRel,
            type: e.isSymbolicLink()
              ? "symlink"
              : e.isDirectory()
                ? "directory"
                : "file",
            class: classifyWorkspacePath(childRel, policy),
          };
        });
        const next = offset + limit < visible.length ? offset + limit : null;
        return {
          data: {
            path: rel,
            entries: page,
            total: visible.length,
            nextOffset: next,
          },
        };
      }
      case "workspace.security.secretScan":
        return this.secretScan(record);
      case "workspace.file.search":
        return {
          data: await this.search(
            record,
            String(input.query ?? ""),
            input.path ?? ".",
          ),
        };
      case "workspace.file.create": {
        this.requireWrite(record, "filesystem.write.workspace");
        const { rel, abs } = this.resolve(record, input.path);
        this.classify(record, rel, "write");
        await this.assertContained(record, abs);
        const content = Buffer.from(String(input.content ?? ""), "utf8");
        if (content.length > policy.maxWriteBytes)
          deny(
            "RESOURCE_LIMIT",
            `content exceeds the ${policy.maxWriteBytes}-byte write limit`,
          );
        if (
          await lstat(abs).then(
            () => true,
            () => false,
          )
        )
          deny(
            "WORKSPACE_CONFLICT",
            "the file already exists (create never overwrites)",
          );
        this.guardBaseline(record, rel);
        await this.remember(record, rel, abs);
        await this.atomicWrite(record, abs, content);
        record.current.set(rel, sha256(content));
        const changes = this.updateChangeSet(record, { [rel]: content.length });
        this.emit(record.view.projectId, "file_created", {
          workspaceId: record.view.workspaceId,
          path: rel,
          afterHash: sha256(content),
          size: content.length,
        });
        return {
          data: { path: rel, sha256: sha256(content), size: content.length },
          changes,
        };
      }
      case "workspace.file.update": {
        this.requireWrite(record, "filesystem.write.workspace");
        const { rel, abs } = this.resolve(record, input.path);
        this.classify(record, rel, "write");
        await this.assertContained(record, abs);
        const content = Buffer.from(String(input.content ?? ""), "utf8");
        if (content.length > policy.maxWriteBytes)
          deny(
            "RESOURCE_LIMIT",
            `content exceeds the ${policy.maxWriteBytes}-byte write limit`,
          );
        const before = await this.currentHash(abs);
        if (before === undefined)
          deny("WORKSPACE_CONFLICT", "the file does not exist");
        if (before !== input.expectedHash)
          deny(
            "WORKSPACE_CONFLICT",
            "the file changed since it was read (expectedHash mismatch)",
          );
        this.guardBaseline(record, rel);
        const beforeSize = (await stat(abs)).size;
        await this.remember(record, rel, abs);
        await this.atomicWrite(record, abs, content);
        record.current.set(rel, sha256(content));
        const changes = this.updateChangeSet(record, {
          [rel]: content.length - beforeSize,
        });
        this.emit(record.view.projectId, "file_modified", {
          workspaceId: record.view.workspaceId,
          path: rel,
          beforeHash: before,
          afterHash: sha256(content),
        });
        return {
          data: {
            path: rel,
            beforeHash: before,
            sha256: sha256(content),
            size: content.length,
          },
          changes,
        };
      }
      case "workspace.file.delete": {
        this.requireWrite(record, "filesystem.delete.workspace");
        const { rel, abs } = this.resolve(record, input.path);
        this.classify(record, rel, "write");
        await this.assertContained(record, abs);
        const before = await this.currentHash(abs);
        if (before === undefined)
          deny("WORKSPACE_CONFLICT", "the file does not exist");
        if (before !== input.expectedHash)
          deny(
            "WORKSPACE_CONFLICT",
            "the file changed since it was read (expectedHash mismatch)",
          );
        this.guardBaseline(record, rel);
        const size = (await stat(abs)).size;
        await this.remember(record, rel, abs);
        await unlink(abs);
        record.current.set(rel, undefined);
        const changes = this.updateChangeSet(record, { [rel]: -size });
        this.emit(record.view.projectId, "file_deleted", {
          workspaceId: record.view.workspaceId,
          path: rel,
          beforeHash: before,
        });
        return {
          data: { path: rel, beforeHash: before, deleted: true },
          changes,
        };
      }
      case "workspace.file.move": {
        this.requireWrite(record, "filesystem.write.workspace");
        this.requireWrite(record, "filesystem.delete.workspace");
        const from = this.resolve(record, input.path);
        const to = this.resolve(record, input.to);
        this.classify(record, from.rel, "write");
        this.classify(record, to.rel, "write");
        await this.assertContained(record, from.abs);
        await this.assertContained(record, to.abs);
        const before = await this.currentHash(from.abs);
        if (before === undefined)
          deny("WORKSPACE_CONFLICT", "the source file does not exist");
        if (before !== input.expectedHash)
          deny(
            "WORKSPACE_CONFLICT",
            "the file changed since it was read (expectedHash mismatch)",
          );
        if (
          await lstat(to.abs).then(
            () => true,
            () => false,
          )
        )
          deny(
            "WORKSPACE_CONFLICT",
            "the target already exists (move never overwrites)",
          );
        this.guardBaseline(record, from.rel);
        this.guardBaseline(record, to.rel);
        await this.remember(record, from.rel, from.abs);
        await this.remember(record, to.rel, to.abs);
        await this.assertContained(record, path.dirname(to.abs));
        await mkdir(path.dirname(to.abs), { recursive: true });
        await this.assertContained(record, path.dirname(to.abs));
        await rename(from.abs, to.abs);
        record.current.set(from.rel, undefined);
        record.current.set(to.rel, before);
        record.movedFrom.set(to.rel, from.rel);
        const changes = this.updateChangeSet(record, {});
        this.emit(record.view.projectId, "file_renamed", {
          workspaceId: record.view.workspaceId,
          from: from.rel,
          to: to.rel,
        });
        return {
          data: { from: from.rel, path: to.rel, sha256: before },
          changes,
        };
      }
      default:
        return deny("TOOL_NOT_ALLOWED", "unknown workspace operation");
    }
  }

  /**
   * EO-4.4 secret scanner: pattern-based scan of source files. Reports path,
   * line and rule only — NEVER the matched value. Findings → tool_failure.
   */
  private async secretScan(record: WorkspaceRecord): Promise<OperationResult> {
    const policy = record.policy;
    const rules: { rule: string; pattern: RegExp }[] = [
      { rule: "known-secret-shape", pattern: KNOWN_SECRET_VALUE_PATTERN },
      {
        rule: "private-key-block",
        pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      },
      { rule: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
      { rule: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    ];
    const findings: { path: string; line: number; rule: string }[] = [];
    const queue: { rel: string; abs: string }[] = [
      { rel: ".", abs: record.root },
    ];
    let scanned = 0;
    let truncated = false;
    while (queue.length > 0 && !truncated) {
      const dir = queue.shift()!;
      const entries = await readdir(dir.abs, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const rel = dir.rel === "." ? entry.name : `${dir.rel}/${entry.name}`;
        const cls = classifyWorkspacePath(rel, policy);
        // Secret-class files are protected by policy (never exposed); the
        // scanner looks for secrets that leaked into ordinary source.
        if (
          entry.isSymbolicLink() ||
          cls === "internal" ||
          cls === "generated" ||
          cls === "secret"
        )
          continue;
        const abs = path.join(dir.abs, entry.name);
        if (entry.isDirectory()) {
          queue.push({ rel, abs });
          continue;
        }
        if (!entry.isFile()) continue;
        if (++scanned > policy.maxSearchFiles) {
          truncated = true;
          break;
        }
        const info = await stat(abs).catch(() => undefined);
        if (!info || info.size > policy.maxSearchFileBytes) continue;
        const content = await readFile(abs).catch(() => undefined);
        if (!content || isBinary(content)) continue;
        const lines = content.toString("utf8").split(/\r?\n/);
        lines.forEach((line, i) => {
          for (const { rule, pattern } of rules) {
            if (
              pattern.test(line) &&
              findings.length < policy.maxSearchResults
            ) {
              findings.push({ path: rel, line: i + 1, rule });
            }
          }
        });
      }
    }
    return {
      data: {
        findings,
        filesScanned: Math.min(scanned, policy.maxSearchFiles),
        truncated,
      },
      exitClass: findings.length > 0 ? "tool_failure" : "success",
    };
  }

  private async search(
    record: WorkspaceRecord,
    query: string,
    start: string | number,
  ): Promise<Record<string, unknown>> {
    const policy = record.policy;
    if (query.trim().length === 0)
      deny("INVALID_TOOL_INPUT", "query must not be empty");
    const needle = query.toLowerCase();
    const { rel: base, abs } = this.resolve(record, start);
    if (classifyWorkspacePath(base, policy) === "internal")
      deny("POLICY_DENIED", "repository internals (.git) are not accessible");
    await this.assertContained(record, abs);
    const results: { path: string; line: number; preview: string }[] = [];
    const queue: { rel: string; abs: string }[] = [{ rel: base, abs }];
    let scanned = 0;
    let truncated = false;
    while (queue.length > 0 && !truncated) {
      const dir = queue.shift()!;
      const entries = await readdir(dir.abs, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const childRel =
          dir.rel === "." ? entry.name : `${dir.rel}/${entry.name}`;
        const cls = classifyWorkspacePath(childRel, policy);
        // Never follow symlinks; skip .git, secrets and generated output.
        if (
          entry.isSymbolicLink() ||
          cls === "internal" ||
          cls === "secret" ||
          cls === "generated"
        )
          continue;
        const childAbs = path.join(dir.abs, entry.name);
        if (entry.isDirectory()) {
          queue.push({ rel: childRel, abs: childAbs });
          continue;
        }
        if (!entry.isFile()) continue;
        if (++scanned > policy.maxSearchFiles) {
          truncated = true;
          break;
        }
        const info = await stat(childAbs).catch(() => undefined);
        if (!info || info.size > policy.maxSearchFileBytes) continue;
        const content = await readFile(childAbs).catch(() => undefined);
        if (!content || isBinary(content)) continue;
        const lines = content.toString("utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i]!.toLowerCase().includes(needle)) {
            results.push({
              path: childRel,
              line: i + 1,
              preview: lines[i]!.trim().slice(0, 200),
            });
            if (results.length >= policy.maxSearchResults) {
              truncated = true;
              break;
            }
          }
        }
        if (truncated) break;
      }
    }
    return { query, results, truncated };
  }

  /* -------------------------------------------------------------- */
  /* Repository (read-only git)                                     */
  /* -------------------------------------------------------------- */

  private gitEnv(root: string, home: string): Record<string, string> {
    const env: Record<string, string> = {
      GIT_DIR: path.join(root, ".git"),
      GIT_WORK_TREE: root,
      GIT_CEILING_DIRECTORIES: path.dirname(root),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: NULL_DEVICE,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      HOME: home,
    };
    if (process.platform === "win32") {
      for (const name of ["SystemRoot", "windir"]) {
        const value = process.env[name];
        if (value) env[name] = value;
      }
    }
    return env;
  }

  private async git(
    record: { root: string; statePath: string },
    argv: readonly string[],
    timeoutMs: number,
    maxOutputBytes: number,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<{
    text: string;
    truncated: boolean;
    exitCode: number | null;
    timedOut: boolean;
    cancelled: boolean;
  }> {
    if (!this.options.gitPath)
      deny("SANDBOX_UNAVAILABLE", "no trusted git executable is configured");
    const run = await runBoundedProcess({
      executable: { executableId: "git", path: this.options.gitPath },
      argv,
      cwd: record.root,
      env: this.gitEnv(record.root, record.statePath),
      timeoutMs,
      maxOutputBytes,
      signal,
    });
    return {
      text: run.stdout.text,
      truncated: run.stdout.truncated,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      cancelled: run.cancelled,
    };
  }

  private async repositoryOperation(
    record: WorkspaceRecord,
    invocation: StructuredInvocation,
    options: SandboxInvokeOptions,
  ): Promise<OperationResult> {
    if (!record.gitDir)
      deny("ENVIRONMENT_UNAVAILABLE", "the workspace is not a git repository");
    const run = await this.git(
      record,
      invocation.argv,
      invocation.timeoutMs,
      Math.max(1024, options.maxOutputBytes),
      options.signal,
    );
    if (run.cancelled) return { data: {}, exitClass: "cancelled" };
    if (run.timedOut) return { data: {}, exitClass: "timeout" };
    if (run.exitCode !== 0)
      return {
        data: { error: "git reported an error" },
        exitClass: "tool_failure",
      };
    const policy = record.policy;
    this.emit(record.view.projectId, "repository_inspected", {
      workspaceId: record.view.workspaceId,
      operationId: invocation.operationId,
    });
    switch (invocation.operationId) {
      case "repository.status": {
        const parsed = parseStatus(run.text);
        return {
          data: {
            ...parsed,
            entries: parsed.entries.slice(0, policy.maxListEntries),
            truncated:
              run.truncated || parsed.entries.length > policy.maxListEntries,
          },
        };
      }
      case "repository.changedFiles": {
        const parsed = parseStatus(run.text);
        const sessionPaths = new Set(
          record.changeSet.entries.flatMap((e) => [
            e.path,
            ...(e.fromPath ? [e.fromPath] : []),
          ]),
        );
        return {
          data: {
            changeSetId: record.changeSet.changeSetId,
            files: parsed.entries.slice(0, policy.maxListEntries).map((e) => ({
              path: e.path,
              status: e.code,
              origin: sessionPaths.has(e.path)
                ? "session"
                : record.baseline.has(e.path)
                  ? "preexisting"
                  : "external",
            })),
            truncated:
              run.truncated || parsed.entries.length > policy.maxListEntries,
          },
        };
      }
      case "repository.diff": {
        const { diff, omitted } = filterDiff(
          run.text,
          (p) => classifyWorkspacePath(p, policy) === "secret",
        );
        const limit = Math.min(
          policy.maxReadBytes,
          Math.max(0, options.maxOutputBytes - 512),
        );
        const buffer = Buffer.from(diff, "utf8");
        const cut = buffer.length > limit;
        return {
          data: {
            diff: cut
              ? buffer.subarray(0, limit).toString("utf8").replace(/�$/, "")
              : diff,
            truncated: cut || run.truncated,
            omittedSecretFiles: omitted,
          },
        };
      }
      case "repository.log":
        return {
          data: { commits: parseLog(run.text), truncated: run.truncated },
        };
      case "repository.currentBranch":
        return { data: { branch: run.text.trim() } };
      default:
        return deny("TOOL_NOT_ALLOWED", "unknown repository operation");
    }
  }

  /* -------------------------------------------------------------- */
  /* EO-4.4 — build runner access, fingerprints, digests            */
  /* -------------------------------------------------------------- */

  /**
   * Trusted: open (or re-enter) the session workspace for a build runner and
   * return its root. Lease, baseline and ownership rules apply exactly as for
   * file operations. Never exposed to agents or the API.
   */
  async rootForBuild(spec: SandboxSpec): Promise<string> {
    const handle = await this.start(spec);
    this.handles.delete(handle.sandboxId);
    return this.records.get(spec.workspace.workspaceId)!.root;
  }

  private async projectRoot(projectId: string): Promise<string> {
    const repo = this.repositories.get(projectId);
    if (!repo?.localPath)
      deny("SANDBOX_UNAVAILABLE", "no attached repository for this project");
    return realpath(repo.localPath);
  }

  /**
   * Deterministic source fingerprint: base revision + every changed or
   * untracked SOURCE file (content hash). Generated output and secret files
   * are excluded (their contents are never hashed into shared evidence).
   */
  async sourceFingerprint(projectId: string): Promise<SourceFingerprint> {
    const root = await this.projectRoot(projectId);
    const home = await realpath(this.options.stateRoot);
    const policy =
      this.options.projectPolicies?.[projectId] ??
      this.options.policy ??
      DEFAULT_WORKSPACE_FILE_POLICY;
    const head = await this.git(
      { root, statePath: home },
      ["rev-parse", "HEAD"],
      30_000,
      1024,
    ).catch(() => undefined);
    const baseRevision = head?.exitCode === 0 ? head.text.trim() : undefined;
    const status = await this.git(
      { root, statePath: home },
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      30_000,
      8 * 1024 * 1024,
    );
    if (status.exitCode !== 0 || status.truncated)
      deny("SANDBOX_FAILURE", "source status could not be read completely");
    const files: [string, string, string][] = [];
    for (const entry of parseStatus(status.text).entries) {
      const cls = classifyWorkspacePath(entry.path, policy);
      if (cls === "generated" || cls === "secret" || cls === "internal")
        continue;
      const abs = path.join(root, ...entry.path.split("/"));
      const hash = await lstat(abs)
        .then(async (i) =>
          i.isFile() ? sha256(await readFile(abs)) : "not-a-file",
        )
        .catch(() => "deleted");
      files.push([entry.path, entry.code, hash]);
    }
    files.sort((a, b) => a[0].localeCompare(b[0]));
    return {
      fingerprint: sha256(
        JSON.stringify({ base: baseRevision ?? null, files }),
      ),
      ...(baseRevision ? { baseRevision } : {}),
      changedFiles: files.length,
    };
  }

  /** SHA-256 + size of a workspace-relative, non-secret file. */
  async digestFile(
    projectId: string,
    requested: string,
  ): Promise<{ sha256: string; size: number }> {
    const root = await this.projectRoot(projectId);
    const rel = resolveWorkspacePath(requested);
    const policy =
      this.options.projectPolicies?.[projectId] ??
      this.options.policy ??
      DEFAULT_WORKSPACE_FILE_POLICY;
    const cls = classifyWorkspacePath(rel, policy);
    if (cls === "secret" || cls === "internal")
      deny("POLICY_DENIED", "secret or internal files are never artifacts");
    const abs = path.join(root, ...rel.split("/"));
    const real = await realpath(abs).catch(() =>
      deny("INVALID_TOOL_INPUT", "artifact not found"),
    );
    assertRealPathWithinRoot(root, real, this.platform());
    const info = await stat(real);
    if (!info.isFile())
      deny("INVALID_TOOL_INPUT", "artifact is not a regular file");
    return { sha256: sha256(await readFile(real)), size: info.size };
  }

  setChangeSetStatus(workspaceId: string, status: ChangeSet["status"]): void {
    const record = this.records.get(workspaceId);
    if (!record) return;
    record.changeSet = { ...record.changeSet, status, updatedAt: this.clock() };
    this.emit(record.view.projectId, "changeset_updated", {
      changeSetId: record.changeSet.changeSetId,
      workspaceId,
      status,
    });
  }

  /* -------------------------------------------------------------- */
  /* WorkspaceControl                                               */
  /* -------------------------------------------------------------- */

  changeSet(workspaceId: string): ChangeSet | undefined {
    const record = this.records.get(workspaceId);
    return record ? structuredClone(record.changeSet) : undefined;
  }

  workspace(workspaceId: string): ManagedWorkspaceView | undefined {
    const record = this.records.get(workspaceId);
    return record ? { ...record.view } : undefined;
  }

  async rollback(
    workspaceId: string,
    sessionId: string,
  ): Promise<RollbackReport> {
    const record = this.records.get(workspaceId);
    if (!record || record.view.sessionId !== sessionId)
      deny("WORKSPACE_VIOLATION", "the workspace belongs to another session");
    if (record.view.state === "closed")
      deny("SANDBOX_UNAVAILABLE", "the workspace is closed");
    const reverted: string[] = [];
    const skipped: { path: string; reason: string }[] = [];
    // Only session-owned paths; each must still hold what THIS session wrote.
    for (const [rel, original] of [...record.originals].reverse()) {
      const { abs } = this.resolve(record, rel);
      await this.assertContained(record, abs);
      const expected = record.current.get(rel);
      const actual = await lstat(abs).then(
        (i) => (i.isFile() ? readFile(abs).then(sha256) : "not-a-file"),
        () => undefined,
      );
      if (actual !== expected) {
        skipped.push({
          path: rel,
          reason: "changed by someone else since the session wrote it",
        });
        continue;
      }
      if (original.hash === undefined) {
        if (actual !== undefined) await unlink(abs);
      } else if (original.backupFile) {
        const content = await readFile(original.backupFile);
        if (sha256(content) !== original.hash) {
          skipped.push({ path: rel, reason: "backup integrity check failed" });
          continue;
        }
        await this.atomicWrite(record, abs, content);
      }
      record.current.set(rel, original.hash);
      reverted.push(rel);
    }
    for (const rel of reverted) {
      record.originals.delete(rel);
      record.current.delete(rel);
      record.movedFrom.delete(rel);
      record.sizes.delete(rel);
    }
    const entries = this.recompute(record);
    record.changeSet = {
      ...record.changeSet,
      entries,
      status: entries.length === 0 ? "rolled_back" : record.changeSet.status,
      updatedAt: this.clock(),
    };
    if (record.view.state === "dirty" && entries.length === 0) {
      record.view = { ...record.view, state: "ready" };
    }
    this.emit(record.view.projectId, "rollback_completed", {
      workspaceId,
      changeSetId: record.changeSet.changeSetId,
      reverted: reverted.length,
      skipped: skipped.length,
    });
    return { changeSetId: record.changeSet.changeSetId, reverted, skipped };
  }

  /**
   * Release the lease and remove ONLY the adapter's own state directory, and
   * only when its ownership marker proves it. The attached working tree is
   * never deleted. Fails closed.
   */
  async release(
    workspaceId: string,
    sessionId: string,
  ): Promise<WorkspaceCleanupReport> {
    const record = this.records.get(workspaceId);
    if (!record)
      return {
        workspaceId,
        released: false,
        removedState: false,
        failure: "unknown workspace",
      };
    if (record.view.sessionId !== sessionId) {
      return {
        workspaceId,
        released: false,
        removedState: false,
        failure: "the workspace belongs to another session",
      };
    }
    if (record.view.state === "closed")
      return { workspaceId, released: true, removedState: true };
    if (record.view.state === "in_use") {
      return {
        workspaceId,
        released: false,
        removedState: false,
        failure: "an operation is still in progress",
      };
    }
    if (record.view.state === "preparing")
      record.view = { ...record.view, state: "failed" };
    this.setState(record, "cleaning");
    const held = this.leases.get(record.root);
    if (held?.workspaceId === workspaceId) this.leases.delete(record.root);
    record.changeSet = {
      ...record.changeSet,
      status:
        record.changeSet.status === "open"
          ? record.changeSet.entries.length > 0
            ? "ready_for_review"
            : "abandoned"
          : record.changeSet.status,
    };
    let removedState = false;
    let failure: string | undefined;
    try {
      const stateRoot = await realpath(this.options.stateRoot);
      const real = await realpath(record.statePath);
      assertRealPathWithinRoot(stateRoot, real, this.platform());
      if (path.dirname(real) !== stateRoot)
        throw new Error("state path is not a direct child of the state root");
      const marker = JSON.parse(
        await readFile(path.join(real, MARKER), "utf8"),
      ) as { workspaceId?: string };
      if (marker.workspaceId !== workspaceId)
        throw new Error("ownership marker does not match");
      await rm(real, { recursive: true, force: true });
      removedState = true;
    } catch (error) {
      failure = `cleanup refused: ${error instanceof Error ? error.message : "ownership not proven"}`;
    }
    record.view = { ...record.view, state: removedState ? "closed" : "failed" };
    this.emit(record.view.projectId, "workspace_closed", {
      workspaceId,
      changeSetId: record.changeSet.changeSetId,
      changeSetStatus: record.changeSet.status,
      removedState,
      ...(failure ? { failure } : {}),
    });
    return {
      workspaceId,
      released: true,
      removedState,
      ...(failure ? { failure } : {}),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Git output parsers                                                 */
/* ------------------------------------------------------------------ */

interface StatusEntry {
  path: string;
  code: string;
  fromPath?: string;
}

export function parseStatus(raw: string): {
  branch?: string;
  entries: StatusEntry[];
} {
  const records = raw.split("\0").filter((r) => r.length > 0);
  const entries: StatusEntry[] = [];
  let branch: string | undefined;
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    if (record.startsWith("## ")) {
      branch = record
        .slice(3)
        .split("...")[0]!
        .replace(/^No commits yet on /, "")
        .trim();
      continue;
    }
    const code = record.slice(0, 2);
    const file = record.slice(3);
    if (code.startsWith("R") || code.startsWith("C")) {
      entries.push({ path: file, code, fromPath: records[i + 1] });
      i += 1;
    } else {
      entries.push({ path: file, code });
    }
  }
  return { ...(branch ? { branch } : {}), entries };
}

export function parseLog(
  raw: string,
): { commit: string; author: string; date: string; subject: string }[] {
  return raw
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [commit = "", author = "", date = "", subject = ""] =
        r.split("\x1f");
      return { commit, author, date, subject: subject.slice(0, 300) };
    });
}

/** Drop per-file diff sections for secret-class files entirely. */
export function filterDiff(
  raw: string,
  isSecret: (path: string) => boolean,
): { diff: string; omitted: string[] } {
  const sections = raw.split(/(?=^diff --git )/m);
  const omitted: string[] = [];
  const kept = sections.filter((section) => {
    const match = /^diff --git a\/(.+?) b\//.exec(section);
    if (match && isSecret(match[1]!)) {
      omitted.push(match[1]!);
      return false;
    }
    return true;
  });
  return { diff: kept.join(""), omitted };
}
