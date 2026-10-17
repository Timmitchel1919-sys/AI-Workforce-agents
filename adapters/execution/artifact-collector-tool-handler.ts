/**
 * `artifacts.collect` tool-action handler (R2).
 *
 * Collects a manifest of files from a per-job workspace: path, size,
 * sha256 digest. The handler never streams raw file contents into the
 * execution receipt — the manifest is a reference, callers that need the
 * bytes read them explicitly through the filesystem handler. Each path
 * resolves through `WorkspaceAccess.resolveInside` so a request for
 * a file outside the workspace is denied.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { ValidationError } from "../../contracts/index.js";
import type { WorkspaceAccess } from "../../core/execution/worker-workspace.js";

export interface ArtifactCollectInput {
  readonly paths: readonly string[];
}

export interface ArtifactCollectOutput {
  readonly artifacts: ReadonlyArray<{
    readonly path: string;
    readonly size: number;
    readonly sha256: string;
  }>;
  readonly skipped: ReadonlyArray<{
    readonly path: string;
    readonly reason: string;
  }>;
}

export interface ArtifactCollectorToolHandlerOptions {
  /** Maximum files per collection call. Default 128. */
  readonly maxFiles?: number;
  /** Per-file size cap for hashing (prevents hashing of huge files). Default 10 MiB. */
  readonly maxFileBytes?: number;
}

export class ArtifactCollectorToolHandler {
  private readonly maxFiles: number;
  private readonly maxFileBytes: number;

  constructor(options: ArtifactCollectorToolHandlerOptions = {}) {
    this.maxFiles = options.maxFiles ?? 128;
    this.maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
  }

  async run(
    lease: WorkspaceAccess,
    input: ArtifactCollectInput,
  ): Promise<ArtifactCollectOutput> {
    if (!Array.isArray(input.paths)) {
      throw new ValidationError("artifacts.collect: paths must be an array");
    }
    if (input.paths.length > this.maxFiles) {
      throw new ValidationError(
        `artifacts.collect: too many paths (${input.paths.length} > ${this.maxFiles})`,
      );
    }
    const artifacts: Array<{
      path: string;
      size: number;
      sha256: string;
    }> = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const path of input.paths) {
      try {
        const absolute = await lease.resolveInside(path);
        const info = await stat(absolute);
        if (!info.isFile()) {
          skipped.push({ path, reason: "not a regular file" });
          continue;
        }
        if (info.size > this.maxFileBytes) {
          skipped.push({ path, reason: "exceeds max artifact size" });
          continue;
        }
        const bytes = await readFile(absolute);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        artifacts.push({ path, size: info.size, sha256 });
      } catch (err) {
        skipped.push({
          path,
          reason:
            err instanceof Error ? err.message : "unknown collection failure",
        });
      }
    }
    return { artifacts, skipped };
  }
}
