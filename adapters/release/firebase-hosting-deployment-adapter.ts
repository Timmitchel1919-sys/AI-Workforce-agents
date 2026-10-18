/**
 * EO-4.6 FirebaseHostingDeploymentAdapter — a REAL `DeploymentAdapter`.
 *
 * Shells out to the `firebase` CLI through the EO-4.2 bounded process
 * runner, so every provider interaction gets `shell: false`, a constructed
 * environment, an output cap, redaction and tree-kill on cancel. The adapter
 * surface is intentionally small:
 *
 *   - deploy()  → `firebase deploy --only hosting:<siteId> --project <ref>
 *                   --non-interactive --json`
 *   - verify()  → HTTP GET of `<site>/__/release.json` and compare its
 *                 `commit` field to the candidate's `commitSha` (BUILD ≠ SIGN
 *                 ≠ PUBLISH: a 200 is not healthy; the commit must match)
 *   - rollback() → `firebase hosting:clone <ref>:<channel>@<version>
 *                   <ref>:<channel>` restoring a KNOWN previous release
 *                   (never "deploy latest")
 *
 * Credentials come from `ctx.credential` (resolved from `target.credentialRef`
 * by the orchestrator through the secret broker). They are passed through
 * `FIREBASE_TOKEN` in the child env; they never appear in argv, logs or
 * receipts.
 *
 * This adapter is OFF by default. Production composition only registers it
 * when a trusted `FirebaseHostingAdapterConfig` is provided; otherwise the
 * release pipeline continues to report deployment as `not_configured`.
 */
import os from "node:os";
import path from "node:path";
import type {
  DeploymentAdapter,
  DeploymentContext,
} from "../../contracts/index.js";
import { noopMetrics, type MetricsPort } from "../../core/observability/index.js";
import {
  runBoundedProcess,
  type BoundedProcessResult,
  type BoundedProcessSpec,
} from "../execution/bounded-process-runner.js";

/** Trusted, composition-time config for one Firebase CLI binding. */
export interface FirebaseHostingAdapterConfig {
  /** Absolute path to the `firebase` CLI (never a caller-supplied path). */
  readonly firebaseExecutable: string;
  /** CI directory passed as --cwd; must be absolute. */
  readonly workingDirectory: string;
  /**
   * Bounded, server-side HTTP fetch used for post-deploy verification.
   * Default: `fetch(url, { signal })`. Tests inject a deterministic stub.
   */
  readonly httpFetch?: (
    url: string,
    options: { signal: AbortSignal },
  ) => Promise<{ status: number; text(): Promise<string> }>;
  /** Injected for tests; defaults to the EO-4.2 bounded process runner. */
  readonly processRunner?: (
    spec: BoundedProcessSpec,
  ) => Promise<BoundedProcessResult>;
  /** R11: optional observability port; emits sanitized counters + timings. */
  readonly metrics?: MetricsPort;
}

interface HostingResourceSpec {
  readonly siteId: string;
  readonly siteBaseUrl: string;
  readonly channelId: string;
}

/**
 * Parse `target.resources` into `firebase hosting` resource specs. The
 * canonical shape is `hosting:<siteId>:<channel>@<siteBaseUrl>` (channel is
 * optional; defaults to `live`). Anything else is refused — we never guess
 * a site URL from an agent-provided value.
 */
function parseHostingResources(
  resources: readonly string[],
): HostingResourceSpec[] {
  const parsed: HostingResourceSpec[] = [];
  for (const spec of resources) {
    if (!spec.startsWith("hosting:")) continue;
    const [body, siteBaseUrl] = spec.split("@");
    const parts = body.split(":");
    if (parts.length < 2 || !parts[1]) continue;
    if (!siteBaseUrl || !/^https:\/\/[A-Za-z0-9.-]+(?:\/|$)/.test(siteBaseUrl)) {
      continue;
    }
    parsed.push({
      siteId: parts[1],
      channelId: parts[2] || "live",
      siteBaseUrl: siteBaseUrl.replace(/\/+$/, ""),
    });
  }
  return parsed;
}

export class FirebaseHostingDeploymentAdapter implements DeploymentAdapter {
  readonly adapterId = "firebase-hosting";
  readonly version = "1.0.0";
  readonly simulated = false;
  private readonly processRunner: (
    spec: BoundedProcessSpec,
  ) => Promise<BoundedProcessResult>;
  private readonly httpFetch: NonNullable<
    FirebaseHostingAdapterConfig["httpFetch"]
  >;
  private readonly metrics: MetricsPort;

  constructor(private readonly config: FirebaseHostingAdapterConfig) {
    if (!path.isAbsolute(config.firebaseExecutable)) {
      throw new Error("firebase CLI must be an absolute path");
    }
    if (!path.isAbsolute(config.workingDirectory)) {
      throw new Error("working directory must be an absolute path");
    }
    this.processRunner = config.processRunner ?? runBoundedProcess;
    this.httpFetch =
      config.httpFetch ??
      (async (url, { signal }) => {
        const r = await fetch(url, { signal });
        return { status: r.status, text: () => r.text() };
      });
    this.metrics = config.metrics ?? noopMetrics;
  }

  async deploy(ctx: DeploymentContext): Promise<{
    providerReleaseId: string;
    failedResources?: readonly string[];
  }> {
    const sites = parseHostingResources(ctx.target.resources);
    if (sites.length === 0) {
      return {
        providerReleaseId: "",
        failedResources: [...ctx.target.resources],
      };
    }
    const failed: string[] = [];
    let providerReleaseId = "";
    for (const site of sites) {
      const argv = [
        "deploy",
        "--only",
        `hosting:${site.siteId}`,
        "--project",
        ctx.target.providerRef,
        "--non-interactive",
        "--json",
      ];
      const result = await this.processRunner({
        executable: {
          executableId: "firebase",
          path: this.config.firebaseExecutable,
        },
        argv,
        cwd: this.config.workingDirectory,
        env: this.buildChildEnv(ctx.credential),
        timeoutMs: ctx.target.timeoutMs,
        maxOutputBytes: 2 * 1024 * 1024,
        signal: ctx.signal,
      });
      if (result.exitCode !== 0 || result.cancelled || result.timedOut) {
        failed.push(`hosting:${site.siteId}`);
        continue;
      }
      // The CLI's --json output contains { status, result: { "<siteId>": {
      // release: "<releaseName>" } } }. We treat an unparseable success as a
      // failed resource (no provider id means we cannot roll back).
      const parsed = safeParseJson(result.stdout.text);
      const releaseName = findReleaseName(parsed, site.siteId);
      if (!releaseName) {
        failed.push(`hosting:${site.siteId}`);
        continue;
      }
      // First successful site stamps the overall release id. The orchestrator
      // treats any `failedResources` entry as FAILED anyway, so a mixed result
      // still fails the release — this id lets rollback target the one we did
      // publish.
      if (!providerReleaseId) providerReleaseId = releaseName;
    }
    this.metrics.counter("firebase_deploy_completed", {
      project: ctx.target.providerRef,
      sites: sites.length,
      failed: failed.length,
    });
    return {
      providerReleaseId,
      ...(failed.length > 0 ? { failedResources: failed } : {}),
    };
  }

  async verify(
    ctx: DeploymentContext,
  ): Promise<{ reachable: boolean; reportedVersion?: string; detail: string }> {
    const sites = parseHostingResources(ctx.target.resources);
    if (sites.length === 0) {
      return { reachable: false, detail: "no hosting resources parsed" };
    }
    // The release.json manifest is produced by the project at build time and
    // served under the reserved `__/` prefix. HEALTHY requires BOTH reachable
    // and the manifest's commit equal to the candidate's commitSha.
    for (const site of sites) {
      const url = `${site.siteBaseUrl}/__/release.json`;
      let response: { status: number; text(): Promise<string> };
      try {
        response = await this.httpFetch(url, { signal: ctx.signal });
      } catch (error) {
        return {
          reachable: false,
          detail: `fetch failed: ${(error as Error).message}`,
        };
      }
      if (response.status !== 200) {
        return {
          reachable: false,
          detail: `release.json responded ${response.status} on ${site.siteId}`,
        };
      }
      const body = await response.text();
      const manifest = safeParseJson(body) as { commit?: unknown } | null;
      const commit = typeof manifest?.commit === "string" ? manifest.commit : "";
      if (!commit) {
        return {
          reachable: true,
          detail: `release.json on ${site.siteId} has no commit field`,
        };
      }
      if (commit !== ctx.candidate.commitSha) {
        return {
          reachable: true,
          reportedVersion: commit,
          detail: `commit mismatch on ${site.siteId}: expected ${ctx.candidate.commitSha}, got ${commit}`,
        };
      }
    }
    return {
      reachable: true,
      reportedVersion: ctx.candidate.commitSha,
      detail: `all ${sites.length} hosting site(s) report the candidate's commit`,
    };
  }

  async rollback(
    ctx: DeploymentContext,
    toProviderReleaseId: string,
  ): Promise<void> {
    if (!toProviderReleaseId) {
      throw new Error("rollback requires a previous providerReleaseId");
    }
    const sites = parseHostingResources(ctx.target.resources);
    if (sites.length === 0) {
      throw new Error("no hosting resources to roll back");
    }
    for (const site of sites) {
      // `firebase hosting:clone <source> <target>` copies a specific previous
      // release (identified by provider release name) back onto the live
      // channel. This is a RESTORE, not a "redeploy latest".
      const argv = [
        "hosting:clone",
        toProviderReleaseId,
        `${ctx.target.providerRef}:${site.channelId}`,
        "--non-interactive",
        "--project",
        ctx.target.providerRef,
      ];
      const result = await this.processRunner({
        executable: {
          executableId: "firebase",
          path: this.config.firebaseExecutable,
        },
        argv,
        cwd: this.config.workingDirectory,
        env: this.buildChildEnv(ctx.credential),
        timeoutMs: ctx.target.timeoutMs,
        maxOutputBytes: 1 * 1024 * 1024,
        signal: ctx.signal,
      });
      if (result.exitCode !== 0 || result.cancelled || result.timedOut) {
        throw new Error(
          `firebase hosting:clone failed on ${site.siteId} (exit ${result.exitCode})`,
        );
      }
    }
  }

  /** Build the child env. Credential rides in via FIREBASE_TOKEN only. */
  private buildChildEnv(credential?: string): Record<string, string> {
    const env: Record<string, string> = {};
    if (process.platform === "win32") {
      for (const name of ["SystemRoot", "windir", "USERPROFILE"] as const) {
        const value = process.env[name];
        if (value) env[name] = value;
      }
    } else {
      const home = process.env.HOME;
      if (home) env.HOME = home;
    }
    // Node needs a tmpdir; the CLI stages release manifests there.
    env.TMPDIR = os.tmpdir();
    if (credential) env.FIREBASE_TOKEN = credential;
    return env;
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findReleaseName(parsed: unknown, siteId: string): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as { result?: unknown };
  const result = envelope.result;
  if (!result || typeof result !== "object") return null;
  const siteEntry = (result as Record<string, unknown>)[siteId];
  if (siteEntry && typeof siteEntry === "object") {
    const release = (siteEntry as Record<string, unknown>).release;
    if (typeof release === "string" && release.length > 0) return release;
  }
  // Fallback: top-level `release` field for single-site deploys.
  const topLevel = (envelope as Record<string, unknown>).release;
  if (typeof topLevel === "string" && topLevel.length > 0) return topLevel;
  return null;
}
