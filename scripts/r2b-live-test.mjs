#!/usr/bin/env node
/* global fetch, setTimeout */
/**
 * R2B live validation driver.
 *
 * Enqueues one `ExecutionJob` through the Control Plane admin endpoint
 * and polls `GET /execution-jobs/{jobId}` until it reaches a terminal
 * state.
 *
 * The script does NOT write to Firestore directly: the deny-all security
 * rule intentionally rejects user credentials, and the admin endpoint is
 * the sanctioned enqueue path. The worker is the ONLY consumer of
 * `execution_jobs` and runs as a dedicated service account.
 *
 * Usage:
 *   # one-time: get a Firebase ID token for an admin operator and export it
 *   export AW_ID_TOKEN="<firebase id token>"
 *   node scripts/r2b-live-test.mjs filesystem-write
 *   node scripts/r2b-live-test.mjs filesystem-exists
 *   node scripts/r2b-live-test.mjs process
 *   node scripts/r2b-live-test.mjs path-traversal       # negative
 *   node scripts/r2b-live-test.mjs disallowed-command   # negative
 */
import { randomUUID } from "node:crypto";

const API_BASE =
  process.env.AW_API_BASE || "https://ai-workforce-agents.web.app/api";
const ID_TOKEN = process.env.AW_ID_TOKEN;
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 120_000;

if (!ID_TOKEN) {
  console.error(
    "AW_ID_TOKEN not set. See scripts/r2b-live-test.mjs header for how to mint one.",
  );
  process.exit(2);
}

const scenario = process.argv[2] ?? "filesystem-write";

function buildTool(scenario) {
  switch (scenario) {
    case "filesystem-write":
      return {
        toolId: "workspace.filesystem",
        action: "write",
        input: {
          action: "write",
          path: "r2b-live.txt",
          content: `R2B live validation at ${new Date().toISOString()}`,
        },
        requiredCapability: "workspace.write",
      };
    case "filesystem-exists":
      return {
        toolId: "workspace.filesystem",
        action: "exists",
        input: { action: "exists", path: "nothing-here.txt" },
        requiredCapability: "workspace.read",
      };
    case "process":
      return {
        toolId: "process",
        action: "run",
        input: { executableId: "node", args: ["--version"], timeoutMs: 10_000 },
        requiredCapability: "process.run",
      };
    case "path-traversal":
      return {
        toolId: "workspace.filesystem",
        action: "read",
        input: { action: "read", path: "../etc/passwd" },
        requiredCapability: "workspace.read",
      };
    case "disallowed-command":
      return {
        toolId: "process",
        action: "run",
        input: { executableId: "bash", args: ["-c", "id"], timeoutMs: 5_000 },
        requiredCapability: "process.run",
      };
    default:
      throw new Error(`unknown scenario: ${scenario}`);
  }
}

async function apiJson(path, init = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${ID_TOKEN}`,
      "content-type": "application/json",
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { status: res.status, body };
}

async function enqueue(scenario) {
  const payload = {
    projectId: "r2b-live",
    taskId: `r2b-${scenario}`,
    agentId: "r2b-driver",
    tool: buildTool(scenario),
    idempotencyKey: `r2b-${scenario}-${randomUUID()}`,
    maxAttempts: 1,
  };
  const { status, body } = await apiJson("/execution-jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (status !== 202 && status !== 200) {
    throw new Error(`enqueue failed: ${status} ${JSON.stringify(body)}`);
  }
  return body.jobId;
}

async function pollUntilTerminal(jobId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { status, body } = await apiJson(`/execution-jobs/${jobId}`);
    if (status === 200 && body?.job) {
      process.stdout.write(
        `\r[r2b] status=${body.job.status} attempt=${body.job.attempt}   `,
      );
      const s = body.job.status;
      if (s === "succeeded" || s === "failed" || s === "cancelled" || s === "dead_letter") {
        process.stdout.write("\n");
        return body.job;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("timed out waiting for job terminal state");
}

async function main() {
  console.log(`[r2b] enqueueing scenario=${scenario} target=${API_BASE}`);
  const jobId = await enqueue(scenario);
  console.log(`[r2b] enqueued jobId=${jobId}`);
  const terminal = await pollUntilTerminal(jobId);
  console.log("[r2b] terminal state:");
  console.log(JSON.stringify(terminal, null, 2));
  process.exit(terminal.status === "succeeded" ? 0 : 1);
}

main().catch((err) => {
  console.error("[r2b] fatal:", err);
  process.exit(2);
});
