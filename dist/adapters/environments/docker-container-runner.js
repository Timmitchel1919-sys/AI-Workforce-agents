/**
 * EO-4.5 DockerContainerRunner — a REAL isolating runner.
 *
 * Wraps a `docker run` invocation around a {@link StructuredInvocation}:
 *
 *   - the trusted docker CLI is spawned via the EO-4.2 bounded process runner
 *     (no shell, constructed environment, output caps, redaction, tree-kill);
 *   - the business executable's argv is passed to the container, never to the
 *     host — the host runs ONLY `docker` with a server-controlled argv;
 *   - every container is created with a hardened default argv: `--rm`,
 *     `--read-only`, `--network=none`, `--cap-drop=ALL`,
 *     `--security-opt=no-new-privileges`, non-root `--user`, memory / cpu /
 *     pids limits and a deterministic `--name` for cancellation;
 *   - images come from a trusted, composition-time
 *     `imagesByExecutable` map (digest-pinned per the container policy); the
 *     policy itself is re-evaluated on every call and refuses privileged,
 *     host-network, host-pid, docker-socket and device requests;
 *   - cancellation issues `docker kill` against the deterministic container
 *     name through the same bounded runner, so a stuck container cannot
 *     outlive its session.
 *
 * This runner is OFF by default: production composition only registers it
 * when a trusted `ContainerPolicy` lists approved digest-pinned images AND a
 * local docker daemon is reachable. Everything else is honestly
 * `not_configured`.
 */
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateContainerRequest, } from "../../contracts/index.js";
import { runBoundedProcess, } from "../execution/bounded-process-runner.js";
const CONTAINER_NAME_PREFIX = "aiw-exec-";
export class DockerContainerRunner {
    options;
    descriptor;
    jobs = new Map();
    processRunner;
    nameFactory;
    constructor(options) {
        this.options = options;
        if (!path.isAbsolute(options.dockerExecutable)) {
            throw new Error("docker executable must be an absolute path");
        }
        if (Object.keys(options.imagesByExecutable).length === 0) {
            throw new Error("DockerContainerRunner requires at least one imagesByExecutable binding");
        }
        this.processRunner = options.processRunner ?? runBoundedProcess;
        this.nameFactory =
            options.nameFactory ?? (() => `${CONTAINER_NAME_PREFIX}${randomUUID()}`);
        const enforcedLimits = [
            "sessionTimeoutMs",
            "operationTimeoutMs",
            "maxOutputBytes",
            "maxArtifactBytes",
            "maxToolCalls",
        ];
        const bindings = Object.values(options.imagesByExecutable);
        if (bindings.some((b) => b.limits?.memoryBytes !== undefined)) {
            enforcedLimits.push("memoryBytes");
        }
        if (bindings.some((b) => b.limits?.cpus !== undefined)) {
            enforcedLimits.push("cpuMillicores");
        }
        if (bindings.some((b) => b.limits?.pidsLimit !== undefined)) {
            enforcedLimits.push("maxProcesses");
        }
        this.descriptor = Object.freeze({
            runnerId: options.runnerId,
            adapterId: options.adapterId,
            environmentInstanceIds: options.environmentInstanceIds,
            runnerClass: "self_hosted",
            trust: "trusted",
            identity: { fingerprint: options.identityFingerprint, verified: true },
            capacity: options.capacity ?? 1,
            sandbox: {
                filesystemIsolation: true,
                networkIsolation: true,
                enforcedLimits,
                networkModes: ["deny_all"],
                supportsKill: true,
            },
        });
    }
    heartbeat() {
        return { status: "online", at: new Date().toISOString() };
    }
    async healthCheck(signal) {
        const present = await access(this.options.dockerExecutable).then(() => true, () => false);
        if (!present)
            return { ready: false, detail: "docker CLI is missing" };
        const result = await this.processRunner({
            executable: { executableId: "docker", path: this.options.dockerExecutable },
            argv: ["version", "--format", "{{.Server.Version}}"],
            cwd: os.tmpdir(),
            env: this.buildChildEnv(),
            timeoutMs: 5_000,
            maxOutputBytes: 4096,
            signal,
        });
        if (result.exitCode === 0 && !result.timedOut && !result.cancelled) {
            return {
                ready: true,
                detail: `daemon ${result.stdout.text.trim() || "online"}`,
            };
        }
        return { ready: false, detail: "docker daemon is not reachable" };
    }
    async prepare(spec) {
        this.jobs.set(spec.jobId, {
            controller: new AbortController(),
            containerName: this.nameFactory(),
        });
    }
    async run(jobId, invocation, options) {
        const job = this.jobs.get(jobId);
        const binding = this.options.imagesByExecutable[invocation.executableId];
        const blank = { text: "", truncated: false, originalBytes: 0 };
        if (!job) {
            return {
                exitClass: "denied",
                exitCode: null,
                stdout: blank,
                stderr: blank,
                durationMs: 0,
                redactions: 0,
                denial: {
                    code: "TOOL_NOT_ALLOWED",
                    detail: "no prepared job for this runner",
                },
            };
        }
        if (!binding) {
            return {
                exitClass: "denied",
                exitCode: null,
                stdout: blank,
                stderr: blank,
                durationMs: 0,
                redactions: 0,
                denial: {
                    code: "TOOL_NOT_ALLOWED",
                    detail: `executable ${invocation.executableId} has no approved image binding on this runner`,
                },
            };
        }
        const policyReasons = evaluateContainerRequest({
            image: {
                name: binding.name,
                version: binding.version,
                ...(binding.digest ? { digest: binding.digest } : {}),
            },
            mounts: [],
        }, this.options.containerPolicy);
        if (policyReasons.length > 0) {
            return {
                exitClass: "denied",
                exitCode: null,
                stdout: blank,
                stderr: blank,
                durationMs: 0,
                redactions: 0,
                denial: {
                    code: "CAPABILITY_NOT_GRANTED",
                    detail: policyReasons[0]?.detail ?? "container policy denied",
                },
            };
        }
        const dockerArgv = this.composeDockerArgv(job.containerName, binding, invocation);
        const signal = AbortSignal.any([options.signal, job.controller.signal]);
        const run = await this.processRunner({
            executable: {
                executableId: "docker",
                path: this.options.dockerExecutable,
            },
            argv: dockerArgv,
            cwd: os.tmpdir(),
            env: this.buildChildEnv(),
            timeoutMs: invocation.timeoutMs,
            maxOutputBytes: options.maxOutputBytes,
            signal,
            knownSecrets: options.knownSecrets,
        });
        return {
            exitClass: run.cancelled
                ? "cancelled"
                : run.timedOut
                    ? "timeout"
                    : run.exitCode === 0
                        ? "success"
                        : "tool_failure",
            exitCode: run.exitCode,
            stdout: run.stdout,
            stderr: run.stderr,
            durationMs: run.durationMs,
            redactions: run.redactions,
        };
    }
    async cancel(jobId) {
        const job = this.jobs.get(jobId);
        if (!job)
            return;
        job.controller.abort();
        try {
            await this.processRunner({
                executable: {
                    executableId: "docker",
                    path: this.options.dockerExecutable,
                },
                argv: ["kill", job.containerName],
                cwd: os.tmpdir(),
                env: this.buildChildEnv(),
                timeoutMs: 5_000,
                maxOutputBytes: 4096,
                signal: AbortSignal.timeout(5_000),
            });
        }
        catch {
            /* already gone / daemon unreachable: nothing more we can do here */
        }
    }
    async release(jobId) {
        this.jobs.delete(jobId);
    }
    buildChildEnv() {
        const env = {};
        if (process.platform === "win32") {
            for (const name of ["SystemRoot", "windir"]) {
                const value = process.env[name];
                if (value)
                    env[name] = value;
            }
        }
        const home = process.env.HOME ?? process.env.USERPROFILE;
        if (home)
            env[process.platform === "win32" ? "USERPROFILE" : "HOME"] = home;
        return env;
    }
    /** Build the hardened `docker run` argv. Pure function, test-friendly. */
    composeDockerArgv(containerName, binding, invocation) {
        const argv = [
            "run",
            "--rm",
            "--read-only",
            "--network=none",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            `--user=${binding.uid ?? 1000}`,
            "--pids-limit",
            String(binding.limits?.pidsLimit ?? 128),
            `--name=${containerName}`,
        ];
        if (binding.limits?.memoryBytes !== undefined) {
            argv.push(`--memory=${binding.limits.memoryBytes}`);
            argv.push(`--memory-swap=${binding.limits.memoryBytes}`);
        }
        if (binding.limits?.cpus !== undefined) {
            argv.push(`--cpus=${binding.limits.cpus}`);
        }
        argv.push(this.formatImageRef(binding));
        const entrypoint = binding.entrypoint ?? [invocation.executableId];
        argv.push(...entrypoint, ...invocation.argv);
        return argv;
    }
    formatImageRef(binding) {
        const base = `${binding.name}:${binding.version}`;
        return binding.digest ? `${base}@${binding.digest}` : base;
    }
}
