/**
 * AI Workforce execution worker (R2).
 *
 * One Cloud Run service that:
 *   1. Signs in to Firestore with Application Default Credentials.
 *   2. Builds a `FirestoreExecutionJobQueue` + `EphemeralLocalWorkspaceManager`.
 *   3. Registers the four initial tool actions (filesystem, process,
 *      tests, artifacts) against a `ToolActionDispatcher`.
 *   4. Serves `GET /healthz` for the Cloud Run liveness probe and runs
 *      the worker loop in the background until SIGTERM.
 *
 * Activation prerequisites that must be completed manually BEFORE this
 * worker will have anything to do (none of which this code can do):
 *   - a Cloud Run service is deployed from this image
 *   - its service account has `datastore.user` on the Firebase project
 *   - the Control Plane is configured to enqueue jobs (feature flag
 *     `EXECUTION_WORKER_ENABLED=true`, out of scope for R2)
 */
import { createServer } from "node:http";
import { EphemeralLocalWorkspaceManager } from "../adapters/workspace/index.js";
import { ArtifactCollectorToolHandler, FilesystemToolHandler, GovernedProcessToolHandler, TestRunnerToolHandler, } from "../adapters/execution/index.js";
import { createFirebaseServices } from "../adapters/firebase/firebase-services.js";
import { FirestoreExecutionJobQueue, isTransactionalFirestore, } from "../adapters/firebase/index.js";
import { resolveTrustedExecutable } from "../adapters/workspace/trusted-executables.js";
import { DEFAULT_COMMAND_POLICY, ToolActionDispatcher, runWorkerLoop, } from "../core/execution/index.js";
const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;
const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const LEASE_TTL_MS = Number.parseInt(process.env.LEASE_TTL_MS ?? "60000", 10);
const IDLE_POLL_MS = Number.parseInt(process.env.IDLE_POLL_MS ?? "2000", 10);
const PROJECT_FILTER = process.env.WORKER_PROJECT_ID;
/** Shared factory so unit tests can build the same dispatcher. */
export function buildDefaultDispatcher(workspace) {
    const dispatcher = new ToolActionDispatcher({ workspace });
    const filesystem = new FilesystemToolHandler();
    const resolve = (executableId) => {
        try {
            const path = resolveTrustedExecutable(executableId);
            return typeof path === "string" ? { executableId, path } : undefined;
        }
        catch {
            return undefined;
        }
    };
    const governedProcess = new GovernedProcessToolHandler({
        resolve,
        policy: DEFAULT_COMMAND_POLICY,
    });
    const tests = new TestRunnerToolHandler({ resolve });
    const artifacts = new ArtifactCollectorToolHandler();
    const fsHandler = ({ workspace, job }) => filesystem.run(workspace, job.tool.input);
    dispatcher.register({ toolId: "workspace.filesystem", action: "read" }, fsHandler);
    dispatcher.register({ toolId: "workspace.filesystem", action: "write" }, fsHandler);
    dispatcher.register({ toolId: "workspace.filesystem", action: "list" }, fsHandler);
    dispatcher.register({ toolId: "workspace.filesystem", action: "exists" }, fsHandler);
    dispatcher.register({ toolId: "process", action: "run" }, ({ workspace, job, signal }) => governedProcess.run(workspace, job.tool.input, signal));
    dispatcher.register({ toolId: "tests", action: "run" }, ({ workspace, job, signal }) => tests.run(workspace, job.tool.input, signal));
    dispatcher.register({ toolId: "artifacts", action: "collect" }, ({ workspace, job }) => artifacts.run(workspace, job.tool.input));
    return dispatcher;
}
export async function bootWorker() {
    const services = await createFirebaseServices();
    if (!isTransactionalFirestore(services.firestore)) {
        throw new Error("worker requires a transactional Firestore client (emulator or admin SDK)");
    }
    const queue = new FirestoreExecutionJobQueue(services.firestore);
    const workspace = new EphemeralLocalWorkspaceManager({
        prefix: "aw-worker",
    });
    const dispatcher = buildDefaultDispatcher(workspace);
    const shutdown = new AbortController();
    const stop = (signal) => () => {
        console.log(`[worker] received ${signal}, draining…`);
        shutdown.abort();
    };
    process.on("SIGTERM", stop("SIGTERM"));
    process.on("SIGINT", stop("SIGINT"));
    const server = createServer((req, res) => {
        if (req.url === "/healthz" || req.url === "/") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({
                status: "ok",
                workerId: WORKER_ID,
                running: !shutdown.signal.aborted,
            }));
            return;
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
    });
    server.listen(PORT, () => {
        console.log(`[worker] health server listening on :${PORT}`);
    });
    console.log(`[worker] starting loop worker=${WORKER_ID} project=${PROJECT_FILTER ?? "*"}`);
    await runWorkerLoop({
        workerId: WORKER_ID,
        queue,
        dispatcher,
        leaseTtlMs: LEASE_TTL_MS,
        idlePollMs: IDLE_POLL_MS,
        projectId: PROJECT_FILTER,
    }, shutdown.signal);
    server.close();
    console.log(`[worker] loop exited`);
}
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
    bootWorker().catch((error) => {
        console.error("[worker] fatal", error);
        process.exit(1);
    });
}
