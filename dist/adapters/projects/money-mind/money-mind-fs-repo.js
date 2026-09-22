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
import { NotFoundError, ValidationError, } from "../../../contracts/index.js";
import { resolveSafeRelativePath } from "./money-mind-path-policy.js";
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
function minimalChildEnv() {
    const source = process.env;
    const keep = [
        "SystemRoot",
        "SystemDrive",
        "TEMP",
        "TMP",
        "HOME",
        "USERPROFILE",
    ];
    const env = {};
    for (const key of keep) {
        if (source[key] !== undefined)
            env[key] = source[key];
    }
    const inheritedPath = source.Path ?? source.PATH ?? "";
    if (process.platform === "win32") {
        // npm executes package scripts through cmd.exe on Windows even when npm
        // itself is launched directly through Node. Ensure the OS command
        // directory remains resolvable without inheriting the full environment.
        const system32 = source.SystemRoot
            ? path.join(source.SystemRoot, "System32")
            : undefined;
        env.Path = [system32, inheritedPath].filter(Boolean).join(path.delimiter);
    }
    else {
        env.PATH = inheritedPath;
    }
    return env;
}
export class NodeMoneyMindRepo {
    repoRoot;
    maxFileBytes;
    constructor(options) {
        if (!options.repoPath || options.repoPath.trim() === "") {
            throw new ValidationError("money-mind repository path must not be blank");
        }
        this.repoRoot = path.resolve(options.repoPath);
        this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    }
    /** Resolve a validated relative path to an absolute path, re-checking containment. */
    resolveAbsolute(relPath) {
        const safe = resolveSafeRelativePath(relPath);
        const absolute = path.resolve(this.repoRoot, safe);
        const withSep = this.repoRoot.endsWith(path.sep)
            ? this.repoRoot
            : this.repoRoot + path.sep;
        if (absolute !== this.repoRoot && !absolute.startsWith(withSep)) {
            throw new ValidationError(`path escapes the money-mind repository root: "${relPath}"`);
        }
        return absolute;
    }
    async ensureRepoPresent() {
        try {
            const stat = await fs.stat(this.repoRoot);
            if (!stat.isDirectory()) {
                throw new NotFoundError(`configured money-mind repository path is not a directory: ${this.repoRoot}`);
            }
        }
        catch (error) {
            if (error instanceof NotFoundError)
                throw error;
            throw new NotFoundError(`money-mind repository is not available at the configured path (set MONEY_MIND_REPO_PATH to a valid local checkout)`);
        }
    }
    /** Never throws — a boolean probe, including when the repo root itself is absent. */
    async exists(relPath) {
        try {
            await fs.stat(this.resolveAbsolute(relPath));
            return true;
        }
        catch {
            return false;
        }
    }
    async readTextFile(relPath) {
        await this.ensureRepoPresent();
        const absolute = this.resolveAbsolute(relPath);
        let stat;
        try {
            stat = await fs.stat(absolute);
        }
        catch {
            throw new NotFoundError(`file not found in money-mind repository: ${relPath}`);
        }
        if (!stat.isFile()) {
            throw new NotFoundError(`not a regular file in money-mind repository: ${relPath}`);
        }
        const handle = await fs.open(absolute, "r");
        try {
            const buffer = Buffer.alloc(Math.min(stat.size, this.maxFileBytes));
            await handle.read(buffer, 0, buffer.length, 0);
            return buffer.toString("utf8");
        }
        finally {
            await handle.close();
        }
    }
    async listDirectory(relPath) {
        await this.ensureRepoPresent();
        const absolute = this.resolveAbsolute(relPath);
        let entries;
        try {
            entries = await fs.readdir(absolute, { withFileTypes: true });
        }
        catch {
            throw new NotFoundError(`directory not found in money-mind repository: ${relPath}`);
        }
        return entries
            .map((entry) => ({
            name: entry.name,
            type: (entry.isDirectory() ? "dir" : "file"),
        }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    async hasScript(script) {
        await this.ensureRepoPresent();
        try {
            const raw = await this.readTextFile("package.json");
            const parsed = JSON.parse(raw);
            const scripts = parsed && typeof parsed === "object"
                ? parsed.scripts
                : undefined;
            return (!!scripts &&
                typeof scripts === "object" &&
                typeof scripts[script] === "string");
        }
        catch {
            return false;
        }
    }
    async runScript(script, timeoutMs) {
        await this.ensureRepoPresent();
        const isWindows = process.platform === "win32";
        // On Windows, bypass both `npm.cmd` and `cmd.exe`: invoke npm's JavaScript
        // entrypoint with the current Node executable. This remains reliable when
        // the deliberately reduced child PATH omits System32, and it removes shell
        // parsing from the execution boundary entirely. npm exposes its absolute
        // entrypoint as `npm_execpath` while this process is run by npm; the
        // adjacent path is the standard fallback for standalone Node execution.
        const npmCli = process.env.npm_execpath ??
            path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
        const command = isWindows ? process.execPath : "npm";
        const args = isWindows ? [npmCli, "run", script] : ["run", script];
        const started = Date.now();
        return new Promise((resolve) => {
            execFile(command, args, {
                cwd: this.repoRoot,
                timeout: timeoutMs,
                windowsHide: true,
                env: minimalChildEnv(),
                maxBuffer: 4 * 1024 * 1024,
            }, (error, stdout, stderr) => {
                const durationMs = Date.now() - started;
                const timedOut = !!error &&
                    "killed" in error &&
                    error.killed === true;
                const exitCode = error && typeof error.code === "number"
                    ? error.code
                    : error
                        ? 1
                        : 0;
                resolve({ exitCode, stdout, stderr, timedOut, durationMs });
            });
        });
    }
}
