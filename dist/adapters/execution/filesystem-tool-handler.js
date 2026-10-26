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
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Buffer } from "node:buffer";
import { classifyWorkspacePath, DEFAULT_WORKSPACE_FILE_POLICY, ValidationError, } from "../../contracts/index.js";
import { mkdir } from "node:fs/promises";
export class FilesystemToolHandler {
    policy;
    constructor(options = {}) {
        this.policy = options.policy ?? DEFAULT_WORKSPACE_FILE_POLICY;
    }
    async run(lease, input) {
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
                const action = input.action;
                throw new ValidationError(`unknown filesystem action: ${action}`);
            }
        }
    }
    async read(lease, input) {
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
    async write(lease, input) {
        if (typeof input.content !== "string") {
            throw new ValidationError("write: content must be a string");
        }
        const bytes = Buffer.byteLength(input.content, "utf8");
        if (bytes > this.policy.maxWriteBytes) {
            throw new ValidationError(`write exceeds maxWriteBytes (${bytes} > ${this.policy.maxWriteBytes})`);
        }
        this.assertNotSecretOrProtected(input.path, "write");
        const absolute = await lease.resolveInside(input.path);
        if (input.createParents) {
            await mkdir(dirname(absolute), { recursive: true });
        }
        await writeFile(absolute, input.content, "utf8");
        return { action: "write", bytes };
    }
    async list(lease, input) {
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
    async exists(lease, input) {
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
        }
        catch (err) {
            if (err.code === "ENOENT") {
                return { action: "exists", kind: "missing" };
            }
            throw err;
        }
    }
    assertNotSecretOrProtected(path, kind) {
        const classification = classifyWorkspacePath(path, this.policy);
        if (classification === "secret") {
            throw new ValidationError(`path classified as secret and may never be ${kind}: ${path}`);
        }
        if (kind === "write" && classification === "protected") {
            throw new ValidationError(`path classified as protected; writes require the filesystem.write.protected capability (not granted here): ${path}`);
        }
    }
}
