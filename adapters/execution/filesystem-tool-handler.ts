/**
 * Governed filesystem tool-action handler (R2).
 *
 * Four actions on a per-job workspace:
 *   - read       → bounded byte read, UTF-8 text + raw byte count, truncated flag
 *   - write      → bounded byte write with explicit size cap
 *   - list       → bounded entries, no recursion into disallowed classes
 *   - exists     → tri-state (file / dir / missing)
 *
 * Every path argument passes through `resolveInside(path)` on the supplied
 * `WorkspaceAccess`, which enforces path confinement. The handler
 * also honours the per-project `WorkspaceFilePolicy` so secret-shaped and
 * protected-shape writes fail closed.
 */
import {
  readFile,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
import { dirname } from "node:path";
import { Buffer } from "node:buffer";
import {
  classifyWorkspacePath,
  DEFAULT_WORKSPACE_FILE_POLICY,
  ValidationError,
  type WorkspaceFilePolicy,
} from "../../contracts/index.js";
import type { WorkspaceAccess } from "../../core/execution/worker-workspace.js";
import { mkdir } from "node:fs/promises";

export type FilesystemAction = "read" | "write" | "list" | "exists";

export interface FilesystemReadInput {
  readonly action: "read";
  readonly path: string;
}
export interface FilesystemReadOutput {
  readonly action: "read";
  readonly content: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

export interface FilesystemWriteInput {
  readonly action: "write";
  readonly path: string;
  readonly content: string;
  /** If true, create missing parent directories. Default false. */
  readonly createParents?: boolean;
}
export interface FilesystemWriteOutput {
  readonly action: "write";
  readonly bytes: number;
}

export interface FilesystemListInput {
  readonly action: "list";
  readonly path: string;
}
export interface FilesystemListOutput {
  readonly action: "list";
  readonly entries: ReadonlyArray<{
    readonly name: string;
    readonly kind: "file" | "directory" | "other";
  }>;
  readonly truncated: boolean;
}

export interface FilesystemExistsInput {
  readonly action: "exists";
  readonly path: string;
}
export interface FilesystemExistsOutput {
  readonly action: "exists";
  readonly kind: "file" | "directory" | "missing";
}

export type FilesystemToolInput =
  | FilesystemReadInput
  | FilesystemWriteInput
  | FilesystemListInput
  | FilesystemExistsInput;

export type FilesystemToolOutput =
  | FilesystemReadOutput
  | FilesystemWriteOutput
  | FilesystemListOutput
  | FilesystemExistsOutput;

export interface FilesystemToolHandlerOptions {
  readonly policy?: WorkspaceFilePolicy;
}

export class FilesystemToolHandler {
  private readonly policy: WorkspaceFilePolicy;

  constructor(options: FilesystemToolHandlerOptions = {}) {
    this.policy = options.policy ?? DEFAULT_WORKSPACE_FILE_POLICY;
  }

  async run(
    lease: WorkspaceAccess,
    input: FilesystemToolInput,
  ): Promise<FilesystemToolOutput> {
    switch (input.action) {
      case "read":
        return this.read(lease, input);
      case "write":
        return this.write(lease, input);
      case "list":
        return this.list(lease, input);
      case "exists":
        return this.exists(lease, input);
      default: {
        const action = (input as { action: string }).action;
        throw new ValidationError(`unknown filesystem action: ${action}`);
      }
    }
  }

  private async read(
    lease: WorkspaceAccess,
    input: FilesystemReadInput,
  ): Promise<FilesystemReadOutput> {
    this.assertNotSecretOrProtected(input.path, "read");
    const absolute = await lease.resolveInside(input.path);
    const buffer = await readFile(absolute);
    const truncated = buffer.length > this.policy.maxReadBytes;
    const bounded = truncated
      ? buffer.subarray(0, this.policy.maxReadBytes)
      : buffer;
    return {
      action: "read",
      content: bounded.toString("utf8"),
      bytes: buffer.length,
      truncated,
    };
  }

  private async write(
    lease: WorkspaceAccess,
    input: FilesystemWriteInput,
  ): Promise<FilesystemWriteOutput> {
    if (typeof input.content !== "string") {
      throw new ValidationError("write: content must be a string");
    }
    const bytes = Buffer.byteLength(input.content, "utf8");
    if (bytes > this.policy.maxWriteBytes) {
      throw new ValidationError(
        `write exceeds maxWriteBytes (${bytes} > ${this.policy.maxWriteBytes})`,
      );
    }
    this.assertNotSecretOrProtected(input.path, "write");
    const absolute = await lease.resolveInside(input.path);
    if (input.createParents) {
      await mkdir(dirname(absolute), { recursive: true });
    }
    await writeFile(absolute, input.content, "utf8");
    return { action: "write", bytes };
  }

  private async list(
    lease: WorkspaceAccess,
    input: FilesystemListInput,
  ): Promise<FilesystemListOutput> {
    const absolute = await lease.resolveInside(input.path);
    const dirents = await readdir(absolute, { withFileTypes: true });
    const truncated = dirents.length > this.policy.maxListEntries;
    const bounded = truncated
      ? dirents.slice(0, this.policy.maxListEntries)
      : dirents;
    return {
      action: "list",
      entries: bounded.map((entry) => ({
        name: entry.name,
        kind: entry.isFile()
          ? "file"
          : entry.isDirectory()
            ? "directory"
            : "other",
      })),
      truncated,
    };
  }

  private async exists(
    lease: WorkspaceAccess,
    input: FilesystemExistsInput,
  ): Promise<FilesystemExistsOutput> {
    const absolute = await lease.resolveInside(input.path);
    try {
      const info = await stat(absolute);
      return {
        action: "exists",
        kind: info.isDirectory()
          ? "directory"
          : info.isFile()
            ? "file"
            : "missing",
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { action: "exists", kind: "missing" };
      }
      throw err;
    }
  }

  private assertNotSecretOrProtected(
    path: string,
    kind: "read" | "write",
  ): void {
    const classification = classifyWorkspacePath(path, this.policy);
    if (classification === "secret") {
      throw new ValidationError(
        `path classified as secret and may never be ${kind}: ${path}`,
      );
    }
    if (kind === "write" && classification === "protected") {
      throw new ValidationError(
        `path classified as protected; writes require the filesystem.write.protected capability (not granted here): ${path}`,
      );
    }
  }
}
