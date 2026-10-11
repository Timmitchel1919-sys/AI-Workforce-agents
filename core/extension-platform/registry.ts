/**
 * Extension Platform registry: registration, versioning, dependency validation, permission
 * grants (deny by default), activation, health and audit.
 *
 * Nothing here executes extension code. Enabling an extension only changes what the platform
 * KNOWS (a skill in a briefing, a tool in the trust catalogue, a workflow template); everything
 * that acts still goes through the existing gateways and the Layer 7 governor.
 */
import {
  EXTENSION_LIMITS,
  EXTENSION_PERMISSION_CATALOG,
  EXTENSION_TYPE_SUPPORT,
  LIFECYCLE_STEPS,
  type DependencyCheck,
  type DependencyKind,
  type ExtensionAuditEvent,
  type ExtensionHealth,
  type ExtensionManifest,
  type ExtensionRecord,
  type ExtensionVersionRecord,
  type ExtensionView,
  type LifecycleView,
  type SkillSpec,
  type ToolSpec,
  type ValidationFinding,
} from "../../contracts/extension-platform.js";
import type { Repository } from "../../contracts/persistence.js";
import type { GovRisk } from "../../contracts/security-governance.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import type { GovernanceLedger } from "../security-governance/ledger.js";
import type { TrustRegistry } from "../security-governance/trust-registry.js";
import { containsSecret } from "../prompt-intelligence/secret-scan.js";
import { validateManifest } from "./manifest.js";
import { compareVersions, parseVersion, satisfies } from "./semver.js";

export type ExtensionErrorCode =
  "invalid_request" | "not_found" | "invalid_state" | "forbidden" | "conflict";
export class ExtensionError extends Error {
  constructor(
    public readonly code: ExtensionErrorCode,
    message: string,
    public readonly findings?: ValidationFinding[],
  ) {
    super(message);
    this.name = "ExtensionError";
  }
}

/** Resolves non-extension dependencies (connectors, models, tools, libraries, environments). */
export interface ExternalDependencyResolver {
  check(
    kind: DependencyKind,
    id: string,
    range?: string,
  ): { ok: boolean; reason: string };
}

export interface ExtensionRepos {
  extensions: Repository<ExtensionRecord>;
  audit: Repository<ExtensionAuditEvent>;
}

const RANK: Record<GovRisk, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};
const permissionRisk = (scope: string): GovRisk =>
  EXTENSION_PERMISSION_CATALOG.find((p) => p.scope === scope)?.risk ??
  "CRITICAL";

export class ExtensionPlatform {
  private readonly extensions: Repository<ExtensionRecord>;
  private readonly auditRepo: Repository<ExtensionAuditEvent>;
  private seq = 0;

  constructor(
    repos: ExtensionRepos,
    private readonly deps: {
      ledger: GovernanceLedger;
      trust?: TrustRegistry;
      external?: ExternalDependencyResolver;
      platformVersion: string;
      clock: () => string;
    },
  ) {
    this.extensions = new SyncCache(repos.extensions);
    this.auditRepo = new SyncCache(repos.audit);
    this.seq = this.auditRepo.list().length;
  }

  /* ------------------------------ reads ------------------------------ */

  record(id: string): ExtensionRecord | undefined {
    return this.extensions.findById(id);
  }
  private require(id: string): ExtensionRecord {
    const r = this.extensions.findById(id);
    if (!r || r.status === "REMOVED")
      throw new ExtensionError("not_found", "extension not found");
    return r;
  }
  private manifestOf(r: ExtensionRecord, version?: string): ExtensionManifest {
    const v = r.versions.find(
      (x) => x.version === (version ?? r.activeVersion ?? r.latestVersion),
    );
    if (!v) throw new ExtensionError("not_found", "version not found");
    return v.manifest;
  }

  list(): ExtensionView[] {
    return this.extensions
      .list()
      .filter((r) => r.status !== "REMOVED")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => this.view(r));
  }
  get(id: string): ExtensionView {
    return this.view(this.require(id));
  }
  audit(extensionId?: string, limit = 100): ExtensionAuditEvent[] {
    return this.auditRepo
      .list()
      .filter((e) => !extensionId || e.extensionId === extensionId)
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .slice(0, Math.min(limit, 500));
  }

  /** Enabled extensions that depend on `id` (by extension dependency). */
  dependentsOf(id: string): { extensionId: string; range?: string }[] {
    const out: { extensionId: string; range?: string }[] = [];
    for (const r of this.extensions.list()) {
      if (r.status !== "ENABLED" || r.extensionId === id) continue;
      const m = this.manifestOf(r);
      for (const d of m.dependencies)
        if (d.kind === "extension" && d.id === id)
          out.push({
            extensionId: r.extensionId,
            ...(d.range ? { range: d.range } : {}),
          });
    }
    return out;
  }

  checkDependencies(m: ExtensionManifest): DependencyCheck[] {
    return m.dependencies.map((dependency) => {
      if (dependency.kind === "extension") {
        const target = this.extensions.findById(dependency.id);
        if (!target || target.status === "REMOVED")
          return {
            dependency,
            satisfied: false,
            reason: `extension "${dependency.id}" is not registered`,
          };
        if (target.status !== "ENABLED" || !target.activeVersion)
          return {
            dependency,
            satisfied: false,
            reason: `extension "${dependency.id}" is not enabled`,
          };
        if (!satisfies(target.activeVersion, dependency.range))
          return {
            dependency,
            satisfied: false,
            reason: `"${dependency.id}" ${target.activeVersion} does not satisfy ${dependency.range}`,
          };
        return {
          dependency,
          satisfied: true,
          reason: `${dependency.id} ${target.activeVersion}`,
        };
      }
      const r = this.deps.external?.check(
        dependency.kind,
        dependency.id,
        dependency.range,
      ) ?? {
        ok: false,
        reason: `no resolver is available for ${dependency.kind} dependencies`,
      };
      return { dependency, satisfied: r.ok, reason: r.reason };
    });
  }

  private platformCompatible(m: ExtensionManifest): {
    ok: boolean;
    reason: string;
  } {
    const range = m.compatibility?.platform;
    if (!range) return { ok: true, reason: "no platform constraint" };
    return satisfies(this.deps.platformVersion, range)
      ? {
          ok: true,
          reason: `platform ${this.deps.platformVersion} satisfies ${range}`,
        }
      : {
          ok: false,
          reason: `requires platform ${range}, running ${this.deps.platformVersion}`,
        };
  }

  private grantsFor(
    r: ExtensionRecord,
    m: ExtensionManifest,
  ): { granted: string[]; missing: string[] } {
    const granted = m.permissions.filter((p) =>
      r.grants.some((g) => g.scope === p),
    );
    return {
      granted,
      missing: m.permissions.filter((p) => !granted.includes(p)),
    };
  }

  health(r: ExtensionRecord): { health: ExtensionHealth; reason: string } {
    if (r.status === "FAILED")
      return { health: "FAILED", reason: r.lastError ?? "activation failed" };
    if (r.status === "REGISTERED")
      return { health: "INSTALLED", reason: "registered, not enabled" };
    if (r.status === "DISABLED")
      return { health: "DISABLED", reason: "disabled by the owner" };
    // ENABLED
    const m = this.manifestOf(r);
    const platform = this.platformCompatible(m);
    if (!platform.ok)
      return { health: "INCOMPATIBLE", reason: platform.reason };
    const bad = this.checkDependencies(m).filter((d) => !d.satisfied);
    if (bad.length > 0)
      return { health: "INCOMPATIBLE", reason: bad[0]!.reason };
    if (
      r.activeVersion &&
      compareVersions(r.latestVersion, r.activeVersion) > 0
    )
      return {
        health: "UPDATE_AVAILABLE",
        reason: `${r.latestVersion} is registered; ${r.activeVersion} is active`,
      };
    return {
      health: "ACTIVE",
      reason: "enabled and all dependencies are satisfied",
    };
  }

  private lifecycle(r: ExtensionRecord): LifecycleView[] {
    const version = r.versions.find(
      (v) => v.version === (r.activeVersion ?? r.latestVersion),
    )!;
    const m = version.manifest;
    const isTool = m.type === "TOOL";
    const done = (b: boolean): LifecycleView["status"] =>
      b ? "DONE" : "PENDING";
    const reviewOk =
      version.review?.outcome === "PASSED" ||
      version.review?.outcome === "APPROVED";
    return LIFECYCLE_STEPS.map((step): LifecycleView => {
      switch (step) {
        case "CREATE":
          return { step, status: "DONE" };
        case "DEFINE_CAPABILITY":
          return { step, status: done(m.capabilities.length > 0) };
        case "DEFINE_TOOLS":
          return isTool || m.type === "SKILL" || m.type === "AGENT"
            ? {
                step,
                status: done(
                  isTool
                    ? !!(m.spec as Partial<ToolSpec>).toolId
                    : ((m.spec as Partial<SkillSpec>).tools ?? []).length >= 0,
                ),
              }
            : { step, status: "NOT_APPLICABLE" };
        case "DEFINE_PERMISSIONS":
          return {
            step,
            status: "DONE",
            note:
              m.permissions.length === 0
                ? "requests no permissions"
                : `${m.permissions.length} requested`,
          };
        case "TEST":
          return {
            step,
            status: version.test
              ? version.test.passed
                ? "DONE"
                : "BLOCKED"
              : "PENDING",
          };
        case "SECURITY_REVIEW":
          return {
            step,
            status: version.review
              ? reviewOk
                ? "DONE"
                : "BLOCKED"
              : "PENDING",
            ...(version.review ? { note: version.review.outcome } : {}),
          };
        case "REGISTER":
          return { step, status: "DONE" };
        case "ENABLE":
          return { step, status: done(r.status === "ENABLED") };
        case "MONITOR":
          return {
            step,
            status: r.status === "ENABLED" ? "DONE" : "PENDING",
            note: this.health(r).reason,
          };
      }
    });
  }

  private view(r: ExtensionRecord): ExtensionView {
    const m = this.manifestOf(r, r.activeVersion ?? r.latestVersion);
    const grants = this.grantsFor(r, m);
    const h = this.health(r);
    const support = EXTENSION_TYPE_SUPPORT[r.type];
    return {
      extensionId: r.extensionId,
      type: r.type,
      name: r.name,
      description: r.description,
      source: r.source,
      status: r.status,
      health: h.health,
      healthReason: h.reason,
      ...(r.activeVersion ? { activeVersion: r.activeVersion } : {}),
      latestVersion: r.latestVersion,
      versions: r.versions.map((v) => ({
        version: v.version,
        registeredAt: v.registeredAt,
        tested: v.test ? v.test.passed : null,
        review: v.review?.outcome ?? null,
      })),
      requestedPermissions: m.permissions,
      grantedPermissions: grants.granted,
      missingGrants: grants.missing,
      dependencies: this.checkDependencies(m),
      capabilities: m.capabilities,
      effect: support.effect,
      supportLevel: support.level,
      lifecycle: this.lifecycle(r),
      config: r.config,
      updatedAt: r.updatedAt,
    };
  }

  /* --------------------------- registration --------------------------- */

  register(
    input: unknown,
    by: string,
    source: "builtin" | "user" = "user",
  ): ExtensionView {
    const { manifest, findings } = validateManifest(input);
    if (!manifest)
      throw new ExtensionError(
        "invalid_request",
        `invalid manifest: ${findings
          .filter((f) => f.level === "ERROR")
          .map((f) => `${f.path}: ${f.message}`)
          .slice(0, 5)
          .join("; ")}`,
        findings,
      );
    const existing = this.extensions.findById(manifest.id);
    if (existing && existing.status !== "REMOVED")
      throw new ExtensionError(
        "conflict",
        "an extension with this id is already registered; register a new version instead",
      );
    const now = this.deps.clock();
    const record: ExtensionRecord = {
      id: manifest.id,
      extensionId: manifest.id,
      type: manifest.type,
      name: manifest.name,
      description: manifest.description,
      source,
      status: "REGISTERED",
      latestVersion: manifest.version,
      versions: [
        {
          version: manifest.version,
          manifest,
          registeredAt: now,
          registeredBy: by,
        },
      ],
      grants: [],
      config: {},
      createdAt: now,
      updatedAt: now,
      updatedBy: by,
    };
    this.extensions.upsert(record);
    this.log(
      record.extensionId,
      by,
      "registered",
      `registered ${manifest.type} ${manifest.version}`,
      manifest.version,
    );
    return this.view(record);
  }

  registerVersion(input: unknown, by: string): ExtensionView {
    const { manifest, findings } = validateManifest(input);
    if (!manifest)
      throw new ExtensionError(
        "invalid_request",
        `invalid manifest: ${findings
          .filter((f) => f.level === "ERROR")
          .map((f) => `${f.path}: ${f.message}`)
          .slice(0, 5)
          .join("; ")}`,
        findings,
      );
    const r = this.require(manifest.id);
    if (manifest.type !== r.type)
      throw new ExtensionError(
        "invalid_request",
        "an extension's type cannot change between versions",
      );
    if (r.versions.some((v) => v.version === manifest.version))
      throw new ExtensionError(
        "conflict",
        "this version is already registered",
      );
    if (compareVersions(manifest.version, r.latestVersion) <= 0)
      throw new ExtensionError(
        "invalid_request",
        `version must be greater than ${r.latestVersion}`,
      );
    if (r.versions.length >= EXTENSION_LIMITS.versions)
      throw new ExtensionError(
        "invalid_state",
        "too many versions are registered",
      );
    const now = this.deps.clock();
    const next: ExtensionRecord = {
      ...r,
      name: manifest.name,
      description: manifest.description,
      latestVersion: manifest.version,
      versions: [
        ...r.versions,
        {
          version: manifest.version,
          manifest,
          registeredAt: now,
          registeredBy: by,
        },
      ],
      updatedAt: now,
      updatedBy: by,
    };
    this.extensions.upsert(next);
    this.log(
      r.extensionId,
      by,
      "version_registered",
      `registered version ${manifest.version}`,
      manifest.version,
    );
    return this.view(next);
  }

  /* ----------------------------- test/review ----------------------------- */

  test(id: string, by: string, version?: string): ExtensionView {
    const r = this.require(id);
    const v = this.versionOf(r, version);
    const findings: ValidationFinding[] = [];
    const re = validateManifest(v.manifest);
    findings.push(...re.findings);
    for (const d of this.checkDependencies(v.manifest))
      if (!d.satisfied)
        findings.push({
          level: "WARNING",
          path: `dependencies.${d.dependency.id}`,
          message: d.reason,
        });
    const platform = this.platformCompatible(v.manifest);
    if (!platform.ok)
      findings.push({
        level: "ERROR",
        path: "compatibility.platform",
        message: platform.reason,
      });
    const passed = !findings.some((f) => f.level === "ERROR");
    const updated = this.replaceVersion(
      r,
      {
        ...v,
        test: {
          passed,
          at: this.deps.clock(),
          findings: findings.slice(0, 40),
        },
      },
      by,
    );
    this.log(
      id,
      by,
      "tested",
      passed
        ? "validation passed"
        : `validation failed (${findings.filter((f) => f.level === "ERROR").length} errors)`,
      v.version,
    );
    return this.view(updated);
  }

  /** Deterministic security review. High-risk requests need an explicit human approval. */
  review(id: string, by: string, version?: string): ExtensionView {
    const r = this.require(id);
    const v = this.versionOf(r, version);
    const findings: string[] = [];
    let outcome: "PASSED" | "NEEDS_APPROVAL" | "BLOCKED" = "PASSED";
    if (!v.test?.passed) {
      outcome = "BLOCKED";
      findings.push("the validation test has not passed");
    }
    let top: GovRisk = "LOW";
    for (const p of v.manifest.permissions) {
      const risk = permissionRisk(p);
      if (RANK[risk] > RANK[top]) top = risk;
      if (RANK[risk] >= RANK.HIGH) findings.push(`requests ${p} (${risk})`);
    }
    if (v.manifest.type === "TOOL") {
      const tool = v.manifest.spec as Partial<ToolSpec>;
      if (tool.risk && RANK[tool.risk] >= RANK.HIGH)
        findings.push(`declares a ${tool.risk} risk tool`);
      if (tool.risk && RANK[tool.risk] > RANK[top]) top = tool.risk;
    }
    if (RANK[top] >= RANK.HIGH && outcome !== "BLOCKED")
      outcome = "NEEDS_APPROVAL";
    if (containsSecret(JSON.stringify(v.manifest))) {
      outcome = "BLOCKED";
      findings.push("the manifest contains a secret");
    }
    if (findings.length === 0)
      findings.push("no high-risk permissions or tools requested");
    const updated = this.replaceVersion(
      r,
      { ...v, review: { outcome, at: this.deps.clock(), findings } },
      by,
    );
    this.log(id, by, "reviewed", `security review: ${outcome}`, v.version);
    return this.view(updated);
  }

  approveReview(id: string, by: string, version?: string): ExtensionView {
    const r = this.require(id);
    const v = this.versionOf(r, version);
    if (v.review?.outcome !== "NEEDS_APPROVAL")
      throw new ExtensionError(
        "invalid_state",
        "this version has no review waiting for approval",
      );
    const updated = this.replaceVersion(
      r,
      {
        ...v,
        review: {
          ...v.review,
          outcome: "APPROVED",
          approvedBy: by,
          at: this.deps.clock(),
        },
      },
      by,
    );
    this.log(
      id,
      by,
      "review_approved",
      "security review approved by the owner",
      v.version,
    );
    return this.view(updated);
  }

  /* ----------------------------- permissions ----------------------------- */

  grant(id: string, scope: string, by: string): ExtensionView {
    const r = this.require(id);
    const m = this.manifestOf(r, r.latestVersion);
    const entry = EXTENSION_PERMISSION_CATALOG.find((p) => p.scope === scope);
    if (!entry)
      throw new ExtensionError("invalid_request", "unknown permission scope");
    if (!entry.grantable)
      throw new ExtensionError(
        "forbidden",
        `${scope} is never granted to an extension`,
      );
    if (!m.permissions.includes(scope))
      throw new ExtensionError(
        "invalid_request",
        "the extension did not request this permission",
      );
    if (r.grants.some((g) => g.scope === scope)) return this.view(r);
    const next = this.save({
      ...r,
      grants: [
        ...r.grants,
        {
          scope,
          grantedBy: by,
          grantedAt: this.deps.clock(),
          version: r.latestVersion,
        },
      ],
      updatedAt: this.deps.clock(),
      updatedBy: by,
    });
    this.log(id, by, "permission_granted", `granted ${scope} (${entry.risk})`);
    return this.view(next);
  }

  revoke(id: string, scope: string, by: string): ExtensionView {
    const r = this.require(id);
    if (!r.grants.some((g) => g.scope === scope))
      throw new ExtensionError("not_found", "that permission is not granted");
    const next = this.save({
      ...r,
      grants: r.grants.filter((g) => g.scope !== scope),
      updatedAt: this.deps.clock(),
      updatedBy: by,
    });
    this.log(id, by, "permission_revoked", `revoked ${scope}`);
    return this.view(next);
  }

  /**
   * The single runtime permission check. Deny by default: the extension must be ENABLED, the
   * ACTIVE version must have requested the scope, and the owner must have granted it.
   */
  authorize(id: string, scope: string): { allowed: boolean; reason: string } {
    const r = this.extensions.findById(id);
    if (!r || r.status !== "ENABLED" || !r.activeVersion)
      return { allowed: false, reason: "the extension is not enabled" };
    const m = this.manifestOf(r);
    if (!m.permissions.includes(scope))
      return {
        allowed: false,
        reason: `the active version did not request ${scope}`,
      };
    if (!r.grants.some((g) => g.scope === scope))
      return { allowed: false, reason: `${scope} has not been granted` };
    return { allowed: true, reason: "granted" };
  }

  /* ------------------------------- activation ------------------------------- */

  /**
   * Enable (or switch to) a version. Refuses unless it passed its test and security review, its
   * dependencies are satisfied and it is platform-compatible. Switching versions also checks
   * compatibility with the active one and with the extensions that depend on this one.
   */
  enable(
    id: string,
    by: string,
    opts: { version?: string; acknowledgeBreaking?: boolean } = {},
  ): ExtensionView {
    const r = this.require(id);
    const v = this.versionOf(r, opts.version);
    const refuse = (message: string): never => {
      this.log(id, by, "enable_refused", message, v.version);
      throw new ExtensionError("invalid_state", message);
    };
    if (!v.test?.passed)
      refuse("the version has not passed its validation test");
    const reviewOk =
      v.review?.outcome === "PASSED" || v.review?.outcome === "APPROVED";
    if (!reviewOk)
      refuse(
        v.review?.outcome === "NEEDS_APPROVAL"
          ? "the security review needs the owner's approval"
          : "the version has not passed its security review",
      );
    const platform = this.platformCompatible(v.manifest);
    if (!platform.ok) refuse(platform.reason);
    const unmet = this.checkDependencies(v.manifest).filter(
      (d) => !d.satisfied,
    );
    if (unmet.length > 0)
      refuse(
        `dependencies are not satisfied: ${unmet.map((d) => d.reason).join("; ")}`,
      );

    const switching =
      r.status === "ENABLED" &&
      r.activeVersion &&
      r.activeVersion !== v.version;
    if (switching) {
      const broken = this.dependentsOf(id).filter(
        (d) => !satisfies(v.manifest.version, d.range),
      );
      if (broken.length > 0)
        refuse(
          `would break dependents: ${broken.map((d) => `${d.extensionId} needs ${d.range}`).join("; ")}`,
        );
      const breaking = this.breakingChanges(this.manifestOf(r), v.manifest);
      if (breaking.length > 0 && !opts.acknowledgeBreaking)
        refuse(`breaking changes must be acknowledged: ${breaking.join("; ")}`);
    }

    this.applyEffect(v.manifest, true, by);
    const { lastError: _cleared, ...rest } = r;
    void _cleared;
    const next = this.save({
      ...rest,
      status: "ENABLED",
      activeVersion: v.version,
      updatedAt: this.deps.clock(),
      updatedBy: by,
    });
    this.log(
      id,
      by,
      switching ? "updated" : "enabled",
      switching ? `switched to ${v.version}` : `enabled ${v.version}`,
      v.version,
    );
    return this.view(next);
  }

  rollback(id: string, toVersion: string, by: string): ExtensionView {
    const r = this.require(id);
    if (r.status !== "ENABLED" || !r.activeVersion)
      throw new ExtensionError(
        "invalid_state",
        "only an enabled extension can be rolled back",
      );
    if (compareVersions(toVersion, r.activeVersion) >= 0)
      throw new ExtensionError(
        "invalid_request",
        "rollback target must be older than the active version",
      );
    const view = this.enable(id, by, {
      version: toVersion,
      acknowledgeBreaking: true,
    });
    this.log(id, by, "rolled_back", `rolled back to ${toVersion}`, toVersion);
    return view;
  }

  disable(id: string, by: string): ExtensionView {
    const r = this.require(id);
    if (r.status !== "ENABLED")
      throw new ExtensionError("invalid_state", "the extension is not enabled");
    const dependents = this.dependentsOf(id);
    if (dependents.length > 0)
      throw new ExtensionError(
        "invalid_state",
        `enabled extensions depend on it: ${dependents.map((d) => d.extensionId).join(", ")}`,
      );
    this.applyEffect(this.manifestOf(r), false, by);
    const next = this.save({
      ...r,
      status: "DISABLED",
      updatedAt: this.deps.clock(),
      updatedBy: by,
    });
    this.log(id, by, "disabled", "disabled", r.activeVersion);
    return this.view(next);
  }

  remove(id: string, by: string): void {
    const r = this.require(id);
    if (r.source === "builtin")
      throw new ExtensionError(
        "forbidden",
        "built-in extensions can be disabled but not removed",
      );
    if (r.status === "ENABLED")
      throw new ExtensionError(
        "invalid_state",
        "disable the extension before removing it",
      );
    this.save({
      ...r,
      status: "REMOVED",
      grants: [],
      updatedAt: this.deps.clock(),
      updatedBy: by,
    });
    this.log(id, by, "removed", "removed (audit history is kept)");
  }

  configure(
    id: string,
    config: Record<string, unknown>,
    by: string,
  ): ExtensionView {
    const r = this.require(id);
    const schema =
      this.manifestOf(r, r.activeVersion ?? r.latestVersion).configSchema ?? {};
    const next: Record<string, string | number | boolean> = {};
    for (const [k, value] of Object.entries(config)) {
      const def = schema[k];
      if (!def)
        throw new ExtensionError(
          "invalid_request",
          `"${k}" is not a configuration option`,
        );
      if (typeof value !== def.type)
        throw new ExtensionError(
          "invalid_request",
          `"${k}" must be a ${def.type}`,
        );
      if (
        typeof value === "string" &&
        (value.length > 500 || containsSecret(value))
      )
        throw new ExtensionError(
          "invalid_request",
          `"${k}" must not contain a secret; extensions never hold credentials`,
        );
      next[k] = value as string | number | boolean;
    }
    const saved = this.save({
      ...r,
      config: { ...r.config, ...next },
      updatedAt: this.deps.clock(),
      updatedBy: by,
    });
    this.log(
      id,
      by,
      "configured",
      `changed ${Object.keys(next).join(", ") || "nothing"}`,
    );
    return this.view(saved);
  }

  /* ---------------------------- consumers ---------------------------- */

  /** Enabled skills relevant to a task, for the execution prompt briefing. */
  skillsFor(input: {
    taskType?: string;
    text?: string;
    limit?: number;
  }): {
    extensionId: string;
    name: string;
    version: string;
    spec: SkillSpec;
  }[] {
    const text = (input.text ?? "").toLowerCase();
    const out: {
      extensionId: string;
      name: string;
      version: string;
      spec: SkillSpec;
    }[] = [];
    for (const r of this.extensions.list()) {
      if (r.status !== "ENABLED" || r.type !== "SKILL" || !r.activeVersion)
        continue;
      const m = this.manifestOf(r);
      const spec = m.spec as SkillSpec;
      const types = spec.appliesTo?.taskTypes;
      const words = spec.appliesTo?.keywords;
      const typeMatch =
        !types ||
        types.length === 0 ||
        (input.taskType ? types.includes(input.taskType) : false);
      const wordMatch =
        !words ||
        words.length === 0 ||
        words.some((w) => text.includes(w.toLowerCase()));
      // A skill with neither constraint applies everywhere; otherwise at least one must match.
      const constrained = (types?.length ?? 0) > 0 || (words?.length ?? 0) > 0;
      if (
        !constrained ||
        (typeMatch && (types?.length ?? 0) > 0) ||
        (wordMatch && (words?.length ?? 0) > 0)
      )
        out.push({
          extensionId: r.extensionId,
          name: r.name,
          version: r.activeVersion,
          spec,
        });
    }
    return out.slice(0, input.limit ?? 5);
  }

  enabledWorkflowTemplates(): {
    extensionId: string;
    name: string;
    version: string;
    stages: import("../../contracts/extension-platform.js").WorkflowStage[];
  }[] {
    return this.extensions
      .list()
      .filter(
        (r) =>
          r.status === "ENABLED" && r.type === "WORKFLOW" && r.activeVersion,
      )
      .map((r) => ({
        extensionId: r.extensionId,
        name: r.name,
        version: r.activeVersion!,
        stages: (
          this.manifestOf(r).spec as {
            stages: import("../../contracts/extension-platform.js").WorkflowStage[];
          }
        ).stages,
      }));
  }

  enabledAgents(): {
    extensionId: string;
    name: string;
    version: string;
    spec: import("../../contracts/extension-platform.js").AgentSpec;
  }[] {
    return this.extensions
      .list()
      .filter(
        (r) => r.status === "ENABLED" && r.type === "AGENT" && r.activeVersion,
      )
      .map((r) => ({
        extensionId: r.extensionId,
        name: r.name,
        version: r.activeVersion!,
        spec: this.manifestOf(r)
          .spec as import("../../contracts/extension-platform.js").AgentSpec,
      }));
  }

  /* ------------------------------ internals ------------------------------ */

  breakingChanges(from: ExtensionManifest, to: ExtensionManifest): string[] {
    const out: string[] = [];
    const a = parseVersion(from.version);
    const b = parseVersion(to.version);
    if (a && b && b.major > a.major)
      out.push(`major version change ${from.version} → ${to.version}`);
    const removed = from.capabilities.filter(
      (c) => !to.capabilities.includes(c),
    );
    if (removed.length > 0)
      out.push(`removes capabilities: ${removed.join(", ")}`);
    const added = to.permissions.filter((p) => !from.permissions.includes(p));
    if (added.length > 0)
      out.push(`requests new permissions: ${added.join(", ")}`);
    return out;
  }

  private applyEffect(m: ExtensionManifest, enable: boolean, by: string): void {
    if (m.type !== "TOOL" || !this.deps.trust) return;
    const spec = m.spec as ToolSpec;
    this.deps.trust.setTool(
      {
        toolId: `ext.${spec.toolId}`,
        name: m.name,
        capabilities: m.capabilities,
        risk: spec.risk,
        permissions: m.permissions,
        environments: ["DEVELOPMENT", "TEST"],
        // No agent may use an extension tool until the owner explicitly allows it.
        allowedAgents: [],
        approval: "ALWAYS",
        securityRequirements: [
          `extension:${m.id}`,
          `environment:${spec.environment}`,
        ],
        status: enable ? "ENABLED" : "DISABLED",
      },
      by,
    );
  }

  private versionOf(
    r: ExtensionRecord,
    version?: string,
  ): ExtensionVersionRecord {
    const v = r.versions.find(
      (x) => x.version === (version ?? r.latestVersion),
    );
    if (!v) throw new ExtensionError("not_found", "version not found");
    return v;
  }
  private replaceVersion(
    r: ExtensionRecord,
    v: ExtensionVersionRecord,
    by: string,
  ): ExtensionRecord {
    return this.save({
      ...r,
      versions: r.versions.map((x) => (x.version === v.version ? v : x)),
      updatedAt: this.deps.clock(),
      updatedBy: by,
    });
  }
  private save(r: ExtensionRecord): ExtensionRecord {
    this.extensions.upsert(r);
    return r;
  }
  private log(
    extensionId: string,
    actor: string,
    action: ExtensionAuditEvent["action"],
    detail: string,
    version?: string,
  ): void {
    const at = this.deps.clock();
    const event: ExtensionAuditEvent = {
      id: `ea-${String(++this.seq).padStart(8, "0")}`,
      at,
      actor,
      extensionId,
      action,
      ...(version ? { version } : {}),
      detail: detail.slice(0, 300),
    };
    this.auditRepo.upsert(event);
    this.deps.ledger.record(`extension.${action}`, {
      actor,
      result: action === "enable_refused" ? "REFUSED" : "OK",
      detail: {
        extensionId,
        ...(version ? { version } : {}),
        note: event.detail,
      },
    });
  }
}
