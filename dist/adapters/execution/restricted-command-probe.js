/**
 * RestrictedCommandProbeRunner — the ONLY process-execution adapter in the
 * foundation, and it is intentionally restrictive.
 *
 *   - accepts a fixed, allowlisted {@link CommandProbeDefinition} only — there
 *     is no function that takes an arbitrary `command` string,
 *   - spawns WITHOUT a shell (`shell: false`) — no expansion, no injection,
 *   - bounds stdout/stderr and running time,
 *   - redacts declared secrets and never exposes a stack trace,
 *   - returns safe exit metadata instead of throwing random process errors.
 *
 * The spawn implementation is injectable so tests stay deterministic and no
 * real process is required. This runner is only meant to be driven by trusted,
 * preregistered probes — never by arbitrary frontend or agent input.
 */
import { spawn } from "node:child_process";
import { validateCommandProbeDefinition, } from "../../contracts/index.js";
const realSpawn = (definition) => new Promise((resolve, reject) => {
    const child = spawn(definition.executable, [...definition.arguments], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const cap = definition.maxOutputBytes;
    child.stdout?.on("data", (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes <= cap)
            stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr?.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= cap)
            stderr = Buffer.concat([stderr, chunk]);
    });
    const timer = setTimeout(() => {
        if (settled)
            return;
        child.kill();
        settled = true;
        resolve({
            exitCode: null,
            signal: "SIGTERM",
            stdout,
            stderr,
            timedOut: true,
        });
    }, definition.timeoutMs);
    child.on("error", (error) => {
        clearTimeout(timer);
        if (settled)
            return;
        settled = true;
        reject(error);
    });
    child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (settled)
            return;
        settled = true;
        resolve({ exitCode: code, signal, stdout, stderr, timedOut: false });
    });
});
export class RestrictedCommandProbeRunner {
    run;
    constructor(run = realSpawn) {
        this.run = run;
    }
    async execute(definition) {
        validateCommandProbeDefinition(definition);
        const started = Date.now();
        let raw;
        try {
            raw = await this.run(definition);
        }
        catch (error) {
            return {
                probeId: definition.id,
                ran: false,
                stdout: "",
                stderr: error instanceof Error ? error.message : String(error),
                outputBytes: 0,
                durationMs: Date.now() - started,
                error: error instanceof Error ? error.message : "process failed to start",
            };
        }
        const stdout = truncateAndRedact(raw.stdout.toString("utf8"), definition.maxOutputBytes, definition.redactSecrets);
        const stderr = truncateAndRedact(raw.stderr.toString("utf8"), definition.maxOutputBytes, definition.redactSecrets);
        const allowed = definition.allowedExitCodes ?? [0];
        const ran = raw.exitCode !== null && !raw.timedOut;
        const ok = ran && allowed.includes(raw.exitCode ?? -1);
        return {
            probeId: definition.id,
            ran,
            exitCode: raw.exitCode ?? undefined,
            stdout,
            stderr: stderr === "" ? undefined : stderr,
            outputBytes: Buffer.byteLength(stdout),
            durationMs: Date.now() - started,
            error: ok
                ? undefined
                : raw.timedOut
                    ? `probe timed out after ${definition.timeoutMs}ms`
                    : ran
                        ? `unexpected exit code ${raw.exitCode}`
                        : "probe did not complete",
        };
    }
}
function truncateAndRedact(text, maxBytes, secrets) {
    let out = text;
    for (const secret of secrets ?? []) {
        if (secret)
            out = out.split(secret).join("******");
    }
    if (Buffer.byteLength(out) > maxBytes) {
        out = out.slice(0, Math.max(0, maxBytes));
    }
    return out;
}
