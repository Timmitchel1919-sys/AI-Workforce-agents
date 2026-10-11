/**
 * Connector registry: lifecycle, installation workflow, trust, mode, versioning and the
 * project ↔ integration ↔ resource mapping.
 *
 * Nothing becomes usable by accident: a connector starts DISCOVERED, in SANDBOX mode,
 * with LIMITED trust and disabled. Enabling it needs credentials, a passing connection
 * test and a passing security validation — and live mode is a separate administrator
 * decision. Configuration is separate from credentials, which live only in the vault.
 */
import type { Repository } from "../../contracts/persistence.js";
import {
  type ConnectorMode,
  type ConnectorState,
  type HealthSnapshot,
  type HubConnector,
  type InstallStep,
  type ProjectIntegrationMapping,
} from "../../contracts/integration-gateway.js";
import type {
  GovEnvironment,
  TrustState,
} from "../../contracts/security-governance.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { containsSecret } from "../prompt-intelligence/secret-scan.js";
import {
  hostAllowed,
  type ConnectorManifest,
  type RestCapability,
} from "./rest.js";
import { BUILTIN_MANIFESTS } from "./manifests.js";
import type { TrustRegistry } from "../security-governance/trust-registry.js";

export class HubError extends Error {
  constructor(
    readonly code:
      "not_found" | "invalid_request" | "invalid_state" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "HubError";
  }
}

const STEPS: InstallStep["step"][] = [
  "REGISTER",
  "INSPECT_CAPABILITIES",
  "DEFINE_PERMISSIONS",
  "DEFINE_RISK",
  "CONFIGURE_AUTH",
  "TEST_CONNECTION",
  "SECURITY_VALIDATION",
  "ENABLE",
];
const SIDE_EFFECTS = ["PUBLISH", "SEND", "DEPLOY", "DELETE"];

export const hubToolId = (capability: string): string => `hub.${capability}`;

export interface RegistryRepos {
  connectors: Repository<HubConnector>;
  mappings: Repository<ProjectIntegrationMapping>;
}

export class HubRegistry {
  private readonly connectors: Repository<HubConnector>;
  private readonly mappings: Repository<ProjectIntegrationMapping>;
  private readonly manifests = new Map<string, ConnectorManifest>();

  constructor(
    repos: RegistryRepos,
    private readonly clock: () => string,
    private readonly trust?: Pick<TrustRegistry, "setTool">,
    manifests: readonly ConnectorManifest[] = BUILTIN_MANIFESTS,
  ) {
    this.connectors = new SyncCache(repos.connectors);
    this.mappings = new SyncCache(repos.mappings);
    for (const m of manifests) this.manifests.set(m.connectorId, m);
  }

  /* ---------------- manifests & records ---------------- */

  manifest(connectorId: string): ConnectorManifest | undefined {
    return this.manifests.get(connectorId);
  }
  manifestsList(): ConnectorManifest[] {
    return [...this.manifests.values()];
  }
  registerManifest(m: ConnectorManifest): void {
    this.manifests.set(m.connectorId, m);
  }

  get(connectorId: string): HubConnector | undefined {
    return this.connectors.findById(connectorId);
  }
  require(connectorId: string): HubConnector {
    const c = this.get(connectorId);
    if (!c) throw new HubError("not_found", "connector not found");
    return c;
  }
  list(): HubConnector[] {
    return this.connectors.list().sort((a, b) => a.name.localeCompare(b.name));
  }
  save(c: HubConnector): HubConnector {
    const next = { ...c, updatedAt: this.clock() };
    this.connectors.upsert(next);
    return next;
  }

  private emptyHealth(status: ConnectorState): HealthSnapshot {
    return {
      status,
      recentCalls: 0,
      recentErrors: 0,
      consecutiveFailures: 0,
      authenticated: false,
    };
  }

  /** Create the record for a manifest (idempotent). Tool trust is registered for every capability. */
  install(connectorId: string, by: string): HubConnector {
    const m = this.manifest(connectorId);
    if (!m) throw new HubError("not_found", "no manifest for this connector");
    const existing = this.get(connectorId);
    if (existing) return existing;
    const now = this.clock();
    const steps: InstallStep[] = STEPS.map((step) => ({
      step,
      status: [
        "REGISTER",
        "INSPECT_CAPABILITIES",
        "DEFINE_PERMISSIONS",
        "DEFINE_RISK",
      ].includes(step)
        ? "DONE"
        : "PENDING",
      ...([
        "REGISTER",
        "INSPECT_CAPABILITIES",
        "DEFINE_PERMISSIONS",
        "DEFINE_RISK",
      ].includes(step)
        ? { at: now }
        : {}),
    }));
    if (m.authMethod === "none")
      steps.find((s) => s.step === "CONFIGURE_AUTH")!.status = "DONE";
    const record: HubConnector = {
      id: m.connectorId,
      connectorId: m.connectorId,
      provider: m.provider,
      name: m.name,
      description: m.description,
      kind: m.kind,
      version: m.version,
      providerApiVersion: m.providerApiVersion,
      capabilityVersions: m.capabilities.map(
        (c) => `${c.capability}@${c.version}`,
      ),
      status: "DISCOVERED",
      trust: "LIMITED",
      mode: "SANDBOX",
      enabled: false,
      auth: {
        method: m.authMethod,
        scopes: m.scopes,
        credentialConfigured: false,
      },
      config: {
        ...(m.baseUrl ? { baseUrl: m.baseUrl } : {}),
        apiVersion: m.providerApiVersion,
      },
      events: m.events,
      environments: m.environments,
      health: this.emptyHealth("DISCOVERED"),
      installation: steps,
      costClass: m.costClass,
      family: m.family,
      createdAt: now,
      updatedAt: now,
      updatedBy: by,
    };
    this.connectors.upsert(record);
    this.registerTools(m);
    return record;
  }

  installAll(by: string): HubConnector[] {
    return this.manifestsList().map((m) => this.install(m.connectorId, by));
  }

  private registerTools(m: ConnectorManifest): void {
    if (!this.trust) return;
    for (const c of m.capabilities) {
      if (c.unavailable) continue;
      this.trust.setTool(
        {
          toolId: hubToolId(c.capability),
          name: c.capability,
          capabilities: [c.capability],
          risk: c.risk,
          permissions: c.permissions,
          environments: ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"],
          allowedAgents: ["*"],
          approval:
            c.operation === "READ"
              ? "NONE"
              : SIDE_EFFECTS.includes(c.operation)
                ? "ALWAYS"
                : "HIGH_RISK",
          securityRequirements: [
            `operation:${c.operation}`,
            `connector:${m.connectorId}`,
          ],
          status: "ENABLED",
        },
        "integration-hub",
      );
    }
  }

  /* ---------------- capabilities ---------------- */

  capabilityOf(
    connectorId: string,
    capability: string,
  ): RestCapability | undefined {
    return this.manifest(connectorId)?.capabilities.find(
      (c) => c.capability === capability,
    );
  }

  /** Connectors that implement a capability (provider abstraction). */
  providersFor(
    capability: string,
  ): { connector: HubConnector; cap: RestCapability }[] {
    const out: { connector: HubConnector; cap: RestCapability }[] = [];
    for (const c of this.list()) {
      const cap = this.capabilityOf(c.connectorId, capability);
      if (cap && !cap.unavailable) out.push({ connector: c, cap });
    }
    return out;
  }

  allCapabilities(): {
    capability: string;
    description: string;
    operation: string;
    risk: string;
    connectorId: string;
    provider: string;
    family: string;
    unavailable?: string;
    permissions: string[];
    sandbox: unknown;
  }[] {
    const rows = [];
    for (const m of this.manifestsList()) {
      for (const c of m.capabilities) {
        rows.push({
          capability: c.capability,
          description: c.description,
          operation: c.operation,
          risk: c.risk,
          connectorId: m.connectorId,
          provider: m.provider,
          family: m.family,
          permissions: c.permissions,
          sandbox: c.sandbox,
          ...(c.unavailable ? { unavailable: c.unavailable } : {}),
        });
      }
    }
    return rows.sort((a, b) => a.capability.localeCompare(b.capability));
  }

  /* ---------------- installation workflow ---------------- */

  setStep(
    connectorId: string,
    step: InstallStep["step"],
    status: InstallStep["status"],
    note?: string,
  ): HubConnector {
    const c = this.require(connectorId);
    const installation = c.installation.map((s) =>
      s.step === step
        ? { step, status, at: this.clock(), ...(note ? { note } : {}) }
        : s,
    );
    return this.save({ ...c, installation });
  }

  configure(
    connectorId: string,
    input: {
      baseUrl?: string;
      environment?: GovEnvironment;
      settings?: Record<string, string>;
    },
    by: string,
  ): HubConnector {
    const c = this.require(connectorId);
    const m = this.manifest(connectorId)!;
    const settings = input.settings ?? c.config.settings ?? {};
    for (const [k, v] of Object.entries(settings)) {
      if (containsSecret(`${k}=${v}`) || containsSecret(v))
        throw new HubError(
          "invalid_request",
          "configuration must not contain credentials; store them in the credential vault",
        );
    }
    let baseUrl = input.baseUrl ?? c.config.baseUrl;
    if (m.requiresBaseUrl && !baseUrl)
      throw new HubError("invalid_request", `${m.name} needs the site URL`);
    if (baseUrl) {
      baseUrl = baseUrl.replace(/\/+$/, "");
      const hosts = m.requiresBaseUrl
        ? [
            new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`)
              .hostname,
          ]
        : m.allowedHosts;
      if (!hostAllowed(baseUrl, hosts))
        throw new HubError(
          "invalid_request",
          "the base URL must be https and match an allowed host",
        );
    }
    const next = this.save({
      ...c,
      config: {
        ...c.config,
        ...(baseUrl ? { baseUrl } : {}),
        ...(input.environment ? { environment: input.environment } : {}),
        ...(Object.keys(settings).length ? { settings } : {}),
      },
      updatedBy: by,
    });
    return this.recompute(next);
  }

  allowedHosts(connectorId: string): string[] {
    const m = this.manifest(connectorId);
    const c = this.get(connectorId);
    if (!m) return [];
    if (m.requiresBaseUrl && c?.config.baseUrl) {
      try {
        return [new URL(c.config.baseUrl).hostname];
      } catch {
        return [];
      }
    }
    return m.allowedHosts;
  }

  /** Deterministic security validation. The result is recorded as the SECURITY_VALIDATION step. */
  validateSecurity(connectorId: string): {
    ok: boolean;
    checks: { check: string; ok: boolean; detail: string }[];
  } {
    const c = this.require(connectorId);
    const m = this.manifest(connectorId)!;
    const checks: { check: string; ok: boolean; detail: string }[] = [];
    const add = (check: string, ok: boolean, detail: string) =>
      checks.push({ check, ok, detail });
    add(
      "authentication",
      m.authMethod === "none" || c.auth.credentialConfigured,
      m.authMethod === "none"
        ? "no credentials needed"
        : c.auth.credentialConfigured
          ? "a credential reference is configured"
          : "no credential is stored",
    );
    if (m.kind === "rest" || m.kind === "graphql") {
      const hosts = this.allowedHosts(connectorId);
      add(
        "host pinning",
        hosts.length > 0 &&
          (!c.config.baseUrl || hostAllowed(c.config.baseUrl, hosts)),
        hosts.length
          ? `requests are pinned to ${hosts.join(", ")}`
          : "no allowed host is configured",
      );
    }
    const live = m.capabilities.filter((x) => !x.unavailable);
    const unsafeSandbox = live.filter(
      (x) => SIDE_EFFECTS.includes(x.operation) && x.sandbox === "ALLOW",
    );
    add(
      "sandbox safety",
      unsafeSandbox.length === 0,
      unsafeSandbox.length
        ? `side effects allowed in sandbox: ${unsafeSandbox.map((x) => x.capability).join(", ")}`
        : "irreversible side effects are denied or substituted in sandbox mode",
    );
    add(
      "scope breadth",
      !m.scopes.some((s) => s === "*" || /\badmin\b/.test(s)),
      "no wildcard or admin scope requested",
    );
    add(
      "configuration separate from credentials",
      !Object.values(c.config.settings ?? {}).some((v) => containsSecret(v)),
      "configuration holds no credential material",
    );
    add(
      "write capabilities gated",
      live
        .filter((x) => x.operation !== "READ")
        .every((x) => x.sandbox !== "ALLOW" || x.operation === "DRAFT"),
      "side-effecting capabilities are not open in sandbox",
    );
    return { ok: checks.every((x) => x.ok), checks };
  }

  runSecurityValidation(connectorId: string): {
    ok: boolean;
    checks: { check: string; ok: boolean; detail: string }[];
  } {
    const r = this.validateSecurity(connectorId);
    this.setStep(
      connectorId,
      "SECURITY_VALIDATION",
      r.ok ? "DONE" : "FAILED",
      r.ok
        ? undefined
        : r.checks
            .filter((x) => !x.ok)
            .map((x) => x.check)
            .join(", "),
    );
    return r;
  }

  enable(connectorId: string, by: string): HubConnector {
    const c = this.require(connectorId);
    const m = this.manifest(connectorId)!;
    if (m.kind === "environment")
      throw new HubError(
        "invalid_state",
        "environment boundaries cannot be enabled: they are declared, not implemented",
      );
    const pending = c.installation.filter(
      (s) => s.step !== "ENABLE" && s.status !== "DONE",
    );
    if (pending.length > 0)
      throw new HubError(
        "invalid_state",
        `finish the installation first: ${pending.map((s) => s.step).join(", ")}`,
      );
    const done = this.setStep(connectorId, "ENABLE", "DONE");
    return this.recompute(this.save({ ...done, enabled: true, updatedBy: by }));
  }

  disable(connectorId: string, by: string): HubConnector {
    const c = this.require(connectorId);
    return this.recompute(this.save({ ...c, enabled: false, updatedBy: by }));
  }

  setTrust(connectorId: string, trust: TrustState, by: string): HubConnector {
    return this.recompute(
      this.save({ ...this.require(connectorId), trust, updatedBy: by }),
    );
  }

  setMode(connectorId: string, mode: ConnectorMode, by: string): HubConnector {
    return this.save({ ...this.require(connectorId), mode, updatedBy: by });
  }

  /** Credential changes flow through here so status and the install step stay consistent. */
  markCredential(
    connectorId: string,
    configured: boolean,
    by: string,
    expiresAt?: string,
  ): HubConnector {
    const c = this.require(connectorId);
    const next = this.save({
      ...c,
      auth: {
        ...c.auth,
        credentialConfigured: configured,
        ...(configured ? { connectedAt: this.clock() } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      },
      updatedBy: by,
    });
    this.setStep(
      connectorId,
      "CONFIGURE_AUTH",
      configured ? "DONE" : "PENDING",
    );
    if (!configured) this.setStep(connectorId, "TEST_CONNECTION", "PENDING");
    return this.recompute(this.require(next.connectorId));
  }

  /**
   * Replace the connector manifest by a newer version. Removing a capability, raising its risk or adding
   * side-effecting capabilities is breaking: the connector is disabled until validated again.
   */
  upgrade(
    connectorId: string,
    next: ConnectorManifest,
    by: string,
    acknowledged: boolean,
  ): { record: HubConnector; breaking: string[] } {
    const c = this.require(connectorId);
    const old = this.manifest(connectorId)!;
    const breaking: string[] = [];
    const rank = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    for (const o of old.capabilities) {
      const n = next.capabilities.find((x) => x.capability === o.capability);
      if (!n) breaking.push(`capability removed: ${o.capability}`);
      else if (rank.indexOf(n.risk) > rank.indexOf(o.risk))
        breaking.push(`risk raised: ${o.capability}`);
      else if (n.operation !== o.operation)
        breaking.push(`operation changed: ${o.capability}`);
    }
    for (const n of next.capabilities)
      if (
        !old.capabilities.some((x) => x.capability === n.capability) &&
        n.operation !== "READ"
      )
        breaking.push(`new side-effecting capability: ${n.capability}`);
    if (breaking.length > 0 && !acknowledged)
      throw new HubError(
        "invalid_request",
        `this upgrade changes behaviour; acknowledge it explicitly: ${breaking.join("; ")}`,
      );
    this.registerManifest(next);
    this.registerTools(next);
    let record = this.save({
      ...c,
      version: next.version,
      providerApiVersion: next.providerApiVersion,
      capabilityVersions: next.capabilities.map(
        (x) => `${x.capability}@${x.version}`,
      ),
      updatedBy: by,
      ...(breaking.length > 0 ? { enabled: false } : {}),
    });
    if (breaking.length > 0) {
      record = this.setStep(
        connectorId,
        "SECURITY_VALIDATION",
        "PENDING",
        "re-validate after a breaking upgrade",
      );
      record = this.setStep(connectorId, "ENABLE", "PENDING");
    }
    return { record: this.recompute(record), breaking };
  }

  /* ---------------- status ---------------- */

  /** Derive the lifecycle state from facts (never stored independently of them). */
  recompute(c: HubConnector): HubConnector {
    const m = this.manifest(c.connectorId);
    let status: ConnectorState;
    const h = c.health;
    const tested =
      c.installation.find((s) => s.step === "TEST_CONNECTION")?.status ===
      "DONE";
    if (
      !c.enabled &&
      c.installation.find((s) => s.step === "ENABLE")?.status === "DONE"
    )
      status = "DISABLED";
    else if (c.trust === "DISABLED" || c.trust === "SUSPENDED")
      status = "DISABLED";
    else if (m && m.authMethod !== "none" && !c.auth.credentialConfigured)
      status = c.auth.connectedAt ? "DISCONNECTED" : "DISCOVERED";
    else if (!tested)
      status =
        c.auth.credentialConfigured || m?.authMethod === "none"
          ? "CONFIGURED"
          : "DISCOVERED";
    else if (
      h.lastError?.kind === "AUTHENTICATION" &&
      h.consecutiveFailures > 0
    )
      status = "ERROR";
    else if (h.consecutiveFailures >= HEALTH_ERROR) status = "ERROR";
    else if (
      h.consecutiveFailures >= 2 ||
      (h.rateLimit?.remaining !== undefined && h.rateLimit.remaining <= 1)
    )
      status = "DEGRADED";
    else status = h.recentCalls > 0 || h.checkedAt ? "HEALTHY" : "CONNECTED";
    if (m?.kind === "environment") status = "DISCOVERED";
    const next = { ...c, status, health: { ...c.health, status } };
    this.connectors.upsert({ ...next, updatedAt: this.clock() });
    return { ...next, updatedAt: this.clock() };
  }

  /* ---------------- project mapping ---------------- */

  mappings_(): ProjectIntegrationMapping[] {
    return this.mappings.list();
  }
  mappingsFor(projectId: string): ProjectIntegrationMapping[] {
    return this.mappings
      .list()
      .filter((m) => m.projectId === projectId && m.status === "ACTIVE");
  }
  mappingFor(
    projectId: string,
    connectorId: string,
  ): ProjectIntegrationMapping[] {
    return this.mappingsFor(projectId)
      .filter((m) => m.connectorId === connectorId)
      .sort((a, b) => (a.role === b.role ? 0 : a.role === "PRIMARY" ? -1 : 1));
  }

  map(input: {
    projectId: string;
    connectorId: string;
    resource: string;
    environment?: GovEnvironment;
    role?: "PRIMARY" | "FALLBACK";
    source: ProjectIntegrationMapping["source"];
    by: string;
  }): ProjectIntegrationMapping {
    this.require(input.connectorId);
    const resource = input.resource.trim();
    if (!resource || resource.length > 300)
      throw new HubError(
        "invalid_request",
        "a resource identifier is required",
      );
    const cap = this.manifest(input.connectorId)!.capabilities.find(
      (c) => c.resourcePattern,
    );
    if (
      cap?.resourcePattern &&
      resource !== "*" &&
      !cap.resourcePattern.test(resource)
    )
      throw new HubError(
        "invalid_request",
        `the resource must look like ${cap.resourceHint ?? "the provider's identifier"}`,
      );
    const id = `map:${input.projectId}:${input.connectorId}:${resource}`;
    const now = this.clock();
    const existing = this.mappings.findById(id);
    const record: ProjectIntegrationMapping = {
      id,
      projectId: input.projectId,
      connectorId: input.connectorId,
      resource,
      ...(input.environment ? { environment: input.environment } : {}),
      role: input.role ?? "PRIMARY",
      source: input.source,
      status: "ACTIVE",
      owner: input.by,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.mappings.upsert(record);
    return record;
  }

  unmap(mappingId: string): boolean {
    const m = this.mappings.findById(mappingId);
    if (!m) return false;
    this.mappings.upsert({ ...m, status: "DISABLED", updatedAt: this.clock() });
    return true;
  }
}

const HEALTH_ERROR = 5;
