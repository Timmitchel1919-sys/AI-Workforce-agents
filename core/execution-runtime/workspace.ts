/**
 * Workspace resolution + governed file system (Layer 5).
 *
 * The resolver never assumes a workspace: a project must have an explicitly
 * REGISTERED binding (trusted configuration), and the binding must still point
 * at a real directory. The host path never leaves this module — descriptors
 * shown to agents and the UI carry no path.
 */
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  RUNTIME_LIMITS,
  RUNTIME_WORKSPACE_OPERATIONS,
  type FileChange,
  type FileOperation,
  type RuntimeWorkspaceDescriptor,
  type RuntimeWorkspaceEnvironment,
  type RuntimeWorkspaceOperation,
} from "../../contracts/execution-runtime.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
import { sha256, unifiedDiff } from "./diff-and-scope.js";
import {
  PathRefusedError,
  isProtectedPath,
  isSensitivePath,
  normalizeRelative,
  resolveInside,
} from "./path-guard.js";

/* ------------------------------------------------------------------ */
/* Registry + resolver                                                */
/* ------------------------------------------------------------------ */

/** Trusted configuration for one project's workspace. Contains a host path. */
export interface WorkspaceBinding {
  workspaceId: string;
  projectId: string;
  rootPath: string;
  repository?: string;
  branch?: string;
  environment: RuntimeWorkspaceEnvironment;
  runtime: string;
  packageManager?: string;
  permittedOperations: readonly RuntimeWorkspaceOperation[];
}

export class WorkspaceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceUnavailableError";
  }
}

export class WorkspaceRegistry {
  private readonly bindings = new Map<string, WorkspaceBinding>();

  register(binding: WorkspaceBinding): void {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(binding.workspaceId)) {
      throw new Error("invalid workspace id");
    }
    if (!path.isAbsolute(binding.rootPath))
      throw new Error("workspace root must be an absolute path");
    for (const op of binding.permittedOperations) {
      if (!RUNTIME_WORKSPACE_OPERATIONS.includes(op))
        throw new Error(`unknown workspace operation ${op}`);
    }
    for (const existing of this.bindings.values()) {
      if (
        existing.projectId !== binding.projectId &&
        existing.rootPath === binding.rootPath
      ) {
        throw new Error("a workspace root cannot be shared between projects");
      }
    }
    this.bindings.set(binding.projectId, {
      ...binding,
      permittedOperations: [...binding.permittedOperations],
    });
  }

  get(projectId: string): WorkspaceBinding | undefined {
    return this.bindings.get(projectId);
  }

  projects(): string[] {
    return [...this.bindings.keys()];
  }
}

export interface ResolvedWorkspace {
  descriptor: RuntimeWorkspaceDescriptor;
  binding: WorkspaceBinding;
  /** realpath of the root; the anchor for every path check. */
  rootReal: string;
}

export class WorkspaceResolver {
  constructor(
    private readonly registry: Pick<WorkspaceRegistry, "get">,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  /** Resolve explicitly, or fail: there is no default workspace. */
  async resolve(projectId: string): Promise<ResolvedWorkspace> {
    const binding = this.registry.get(projectId);
    if (!binding || binding.projectId !== projectId) {
      throw new WorkspaceUnavailableError(
        `no workspace is registered for project ${projectId}`,
      );
    }
    let rootReal: string;
    try {
      rootReal = await realpath(binding.rootPath);
      if (!(await stat(rootReal)).isDirectory())
        throw new Error("not a directory");
    } catch {
      throw new WorkspaceUnavailableError(
        "the registered workspace is not available on this host",
      );
    }
    let scripts: string[] = [];
    let packageManager = binding.packageManager;
    try {
      const pkg = JSON.parse(
        await readFile(path.join(rootReal, "package.json"), "utf8"),
      ) as { scripts?: Record<string, unknown> };
      scripts = Object.keys(pkg.scripts ?? {});
    } catch {
      /* not a Node project: no scripts */
    }
    if (!packageManager) {
      for (const [file, name] of [
        ["pnpm-lock.yaml", "pnpm"],
        ["yarn.lock", "yarn"],
        ["package-lock.json", "npm"],
      ] as const) {
        try {
          await stat(path.join(rootReal, file));
          packageManager = name;
          break;
        } catch {
          /* try next */
        }
      }
    }
    return {
      binding,
      rootReal,
      descriptor: {
        workspaceId: binding.workspaceId,
        projectId: binding.projectId,
        ...(binding.repository ? { repository: binding.repository } : {}),
        ...(binding.branch ? { branch: binding.branch } : {}),
        environment: binding.environment,
        runtime: binding.runtime,
        ...(packageManager ? { packageManager } : {}),
        permittedOperations: [...binding.permittedOperations],
        scripts,
        resolvedAt: this.clock(),
      },
    };
  }
}

/* ------------------------------------------------------------------ */
/* Governed file system                                               */
/* ------------------------------------------------------------------ */

export class ApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}
export class FileConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileConflictError";
  }
}

export interface TreeEntry {
  path: string;
  type: "file" | "dir";
  size?: number;
}

const HIDDEN_DIRS = new Set([
  "node_modules",
  ".git",
  ".firebase",
  ".next",
  "coverage",
]);
const MAX_WRITE_BYTES = 512 * 1024;

export interface ChangeContext {
  taskId: string;
  agentId: string;
  clock: () => string;
}

export class GovernedFileSystem {
  private operations = 0;

  constructor(
    private readonly rootReal: string,
    private readonly permitted: readonly RuntimeWorkspaceOperation[],
    private readonly ctx: ChangeContext,
  ) {}

  private allow(op: RuntimeWorkspaceOperation): void {
    if (!this.permitted.includes(op)) {
      throw new PathRefusedError(
        "protected_path",
        `the workspace does not permit "${op}"`,
      );
    }
    this.operations += 1;
    if (this.operations > RUNTIME_LIMITS.maxFileOps) {
      throw new Error("file operation limit reached for this execution");
    }
  }

  async tree(
    dir = ".",
    maxDepth = 6,
    maxEntries = 400,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    this.allow("list");
    const start = await resolveInside(this.rootReal, dir);
    const entries: TreeEntry[] = [];
    let truncated = false;
    const walk = async (
      abs: string,
      rel: string,
      depth: number,
    ): Promise<void> => {
      let names: import("node:fs").Dirent[];
      try {
        names = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      names.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of names) {
        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }
        const childRel = rel === "." ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (HIDDEN_DIRS.has(entry.name)) continue;
          entries.push({ path: childRel, type: "dir" });
          if (depth < maxDepth)
            await walk(path.join(abs, entry.name), childRel, depth + 1);
        } else if (entry.isFile()) {
          if (isSensitivePath(childRel)) continue; // existence of credentials is not advertised
          entries.push({ path: childRel, type: "file" });
        }
      }
    };
    await walk(start.absolute, start.relative, 1);
    return { entries, truncated };
  }

  async read(input: unknown): Promise<{
    path: string;
    content: string;
    size: number;
    hash: string;
    truncated: boolean;
  }> {
    this.allow("read");
    const target = await resolveInside(this.rootReal, input);
    const info = await stat(target.absolute);
    if (!info.isFile())
      throw new PathRefusedError("invalid_path", "not a file");
    const raw = await readFile(target.absolute);
    if (raw.subarray(0, 8000).includes(0))
      throw new PathRefusedError("invalid_path", "binary files cannot be read");
    const truncated = raw.length > RUNTIME_LIMITS.maxReadBytes;
    const text = raw.subarray(0, RUNTIME_LIMITS.maxReadBytes).toString("utf8");
    return {
      path: target.relative,
      content: maskSecrets(text),
      size: raw.length,
      hash: sha256(raw),
      truncated,
    };
  }

  async create(input: unknown, content: unknown): Promise<FileChange> {
    this.allow("create");
    const text = this.text(content);
    const target = await this.writable(input);
    if (await exists(target.absolute))
      throw new FileConflictError("the file already exists");
    await mkdir(path.dirname(target.absolute), { recursive: true });
    await writeFile(target.absolute, text, { encoding: "utf8", flag: "wx" });
    return this.change(target.relative, "create", { after: text });
  }

  async update(
    input: unknown,
    content: unknown,
    expectedHash?: string,
  ): Promise<FileChange> {
    this.allow("update");
    const text = this.text(content);
    const target = await this.writable(input);
    const before = await readFile(target.absolute, "utf8").catch(
      () => undefined,
    );
    if (before === undefined)
      throw new FileConflictError("the file does not exist");
    if (expectedHash !== undefined && sha256(before) !== expectedHash) {
      throw new FileConflictError("the file changed since it was read");
    }
    await writeFile(target.absolute, text, "utf8");
    return this.change(target.relative, "update", { before, after: text });
  }

  async rename(
    from: unknown,
    to: unknown,
    operation: "rename" | "move" = "rename",
  ): Promise<FileChange> {
    this.allow(operation);
    const source = await this.writable(from);
    const dest = await this.writable(to);
    if (!(await exists(source.absolute)))
      throw new FileConflictError("the source does not exist");
    if (await exists(dest.absolute))
      throw new FileConflictError("the destination already exists");
    await mkdir(path.dirname(dest.absolute), { recursive: true });
    await rename(source.absolute, dest.absolute);
    return {
      ...this.change(dest.relative, operation, {}),
      renamedFrom: source.relative,
    };
  }

  /** Deletion is destructive: it requires the task's human approval. */
  async delete(input: unknown, approved: boolean): Promise<FileChange> {
    this.allow("delete");
    if (!approved) {
      throw new ApprovalRequiredError(
        "deleting a file requires an approved human decision for this task",
      );
    }
    const target = await this.writable(input);
    const info = await stat(target.absolute).catch(() => undefined);
    if (!info?.isFile())
      throw new FileConflictError("only existing files can be deleted");
    const before = await readFile(target.absolute, "utf8").catch(
      () => undefined,
    );
    await unlink(target.absolute);
    return this.change(target.relative, "delete", { before });
  }

  private async writable(input: unknown) {
    const relative = normalizeRelative(input);
    if (isProtectedPath(relative)) {
      throw new PathRefusedError(
        "protected_path",
        "this path is protected and cannot be modified",
      );
    }
    return resolveInside(this.rootReal, relative);
  }

  private text(content: unknown): string {
    if (typeof content !== "string")
      throw new PathRefusedError("invalid_path", "content must be text");
    if (Buffer.byteLength(content) > MAX_WRITE_BYTES)
      throw new PathRefusedError("invalid_path", "content is too large");
    return content;
  }

  private change(
    relative: string,
    operation: FileOperation,
    contents: { before?: string; after?: string },
  ): FileChange {
    const diff =
      operation === "rename" || operation === "move"
        ? undefined
        : unifiedDiff(contents.before, contents.after, relative);
    return {
      path: relative,
      operation,
      at: this.ctx.clock(),
      taskId: this.ctx.taskId,
      agentId: this.ctx.agentId,
      ...(contents.before !== undefined
        ? {
            beforeHash: createHash("sha256")
              .update(contents.before)
              .digest("hex"),
          }
        : {}),
      ...(contents.after !== undefined
        ? {
            afterHash: createHash("sha256")
              .update(contents.after)
              .digest("hex"),
          }
        : {}),
      ...(diff ? { diff } : {}),
    };
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
