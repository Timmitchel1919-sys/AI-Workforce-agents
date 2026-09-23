/**
 * EnvironmentDetector — the discovery orchestration boundary.
 *
 *   Host request → applicable probes → DetectedEnvironment[] → registry
 *
 * The detector is responsible for everything about a discovery pass: choosing
 * probes for the host platform, running them (errors become warnings, never
 * fatal), computing fingerprints, updating host + instance records idempotently,
 * marking previously-seen-but-now-missing environments unavailable, and
 * recording structured audit events. It never guesses: no OS inference, no
 * fake availability, no synthetic environments.
 */
import {
  type CapabilityDeclaration,
  type DetectedEnvironment,
  type EnvironmentInstance,
  type EnvironmentType,
  type HostInstance,
  type HostType,
  type OperatingSystem,
  type ToolchainDescriptor,
  type TrustLevel,
  formatVersion,
  validateDetectedEnvironment,
} from "../../contracts/index.js";
import { type AuditLog } from "../audit/audit-log.js";
import { now } from "../shared.js";
import { HostCapabilityDiscovery } from "./capability-discovery.js";
import {
  environmentFingerprint,
  hostFingerprint,
  instanceIdForFingerprint,
} from "./fingerprint.js";
import { type ProbeRegistry } from "./environment-probe.js";
import { EnvironmentRegistry } from "./environment-registry.js";

export interface DetectHostRequest {
  hostId: string;
  name: string;
  hostType: HostType;
  os: OperatingSystem;
  trustLevel?: TrustLevel;
  costCenter?: string;
  safeMetadata?: Record<string, unknown>;
  /** Capabilities the host owner declares (highest trust, so they win). */
  declaredCapabilities?: readonly CapabilityDeclaration[];
  /** Toolchains the host owner declares (used for capability mapping). */
  declaredToolchains?: readonly ToolchainDescriptor[];
  /** Restrict discovery to these probe ids. Default: all applicable. */
  probes?: readonly string[];
  /** Injectable deterministic timestamp. */
  detectedAt?: string;
}

export interface DetectionOutcome {
  hostId: string;
  host: HostInstance;
  detected: readonly EnvironmentType[];
  registered: readonly string[];
  refreshed: readonly string[];
  madeUnavailable: readonly string[];
  warnings: readonly string[];
}

export interface EnvironmentDetectorOptions {
  /** Overrides the default absolute clock for deterministic tests. */
  clock?: () => string;
}

export class EnvironmentDetector {
  private readonly discovery: HostCapabilityDiscovery;
  private readonly resolvedClock: () => string;

  constructor(
    private readonly registry: EnvironmentRegistry,
    private readonly probes: ProbeRegistry,
    private readonly audit?: AuditLog,
    options: EnvironmentDetectorOptions = {},
  ) {
    this.resolvedClock = options.clock ?? now;
    this.discovery = new HostCapabilityDiscovery({
      clock: this.resolvedClock,
    });
  }

  async detect(request: DetectHostRequest): Promise<DetectionOutcome> {
    const detectedAt = request.detectedAt ?? this.resolvedClock();
    const warnings: string[] = [];
    const sources: string[] = [];

    const applicable = this.probes
      .applicable(request.os)
      .filter(
        (probe) =>
          request.probes === undefined || request.probes.includes(probe.id),
      );

    const results: ProbeRun[] = [];
    for (const probe of applicable) {
      try {
        const result = await probe.detect({
          hostId: request.hostId,
          os: request.os,
        });
        validateDetectedEnvironment(result);
        results.push({ probeId: probe.id, detected: result });
        for (const warning of result.warnings) warnings.push(warning);
      } catch (error) {
        warnings.push(
          `probe "${probe.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      sources.push(probe.id);
    }

    const executed = results.map((r) => r.detected);
    const detected = executed.filter((d) => d.detected);
    const reachable = executed.length > 0;
    const hostAvailability: HostInstance["availability"] = reachable
      ? "available"
      : "unavailable";

    const report = this.discovery.derive(
      request.hostId,
      executed,
      {
        capabilities: request.declaredCapabilities,
        toolchains: request.declaredToolchains,
      },
      sources,
    );
    for (const warning of report.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }

    const host = this.upsertHost(
      request,
      hostAvailability,
      report.capabilities,
      detectedAt,
    );
    const registered: string[] = [];
    const refreshed: string[] = [];

    const detectedFingerprints = new Set<string>();
    for (const env of detected) {
      const fingerprint = environmentFingerprint(
        request.hostId,
        env.environmentType,
        env.version ? formatVersion(env.version) : undefined,
        env.installation,
      );
      detectedFingerprints.add(fingerprint);

      const descriptor = this.registry.descriptorForType(env.environmentType);
      if (!descriptor) {
        warnings.push(
          `environment "${env.environmentType}" detected but has no descriptor; not registered`,
        );
        continue;
      }

      const existing = this.registry.findByFingerprint(
        request.hostId,
        fingerprint,
      );
      const instance: EnvironmentInstance = {
        id: existing?.id ?? instanceIdForFingerprint(fingerprint),
        descriptorId: descriptor.id,
        hostId: request.hostId,
        environmentType: env.environmentType,
        name: descriptor.name,
        version: env.version,
        installation: env.installation,
        availability: env.availability,
        capabilities: this.discovery.derive(
          request.hostId,
          [env],
          { toolchains: request.declaredToolchains },
          [env.environmentType],
        ).capabilities,
        toolchains: env.toolchains,
        trustLevel: request.trustLevel ?? "detected",
        fingerprint,
        lastDetectedAt: detectedAt,
        lastVerifiedAt: detectedAt,
        safeMetadata: request.safeMetadata,
      };

      const persisted = this.registry.upsertInstance(instance);
      if (existing) {
        refreshed.push(persisted.id);
        this.audit?.record("environment_refreshed", {
          data: { hostId: request.hostId, descriptorId: descriptor.id },
        });
      } else {
        registered.push(persisted.id);
        this.audit?.record("environment_discovered", {
          data: { hostId: request.hostId, descriptorId: descriptor.id },
        });
      }
    }

    const madeUnavailable = this.markMissingInstancesUnavailable(
      request.hostId,
      detectedFingerprints,
      detectedAt,
      warnings,
    );

    return {
      hostId: request.hostId,
      host,
      detected: detected.map((d) => d.environmentType),
      registered,
      refreshed,
      madeUnavailable,
      warnings,
    };
  }

  /**
   * Previously-registered instances on this host that were not re-detected are
   * transitioned to `unavailable` — never silently dropped, never kept
   * available. Credentials/sensitive data are not touched.
   */
  private markMissingInstancesUnavailable(
    hostId: string,
    stillPresentFingerprints: ReadonlySet<string>,
    detectedAt: string,
    warnings: string[],
  ): string[] {
    const madeUnavailable: string[] = [];
    for (const instance of this.registry.instancesForHost(hostId)) {
      if (
        instance.availability === "available" &&
        !stillPresentFingerprints.has(instance.fingerprint)
      ) {
        this.registry.markInstanceUnavailable(instance.id, { now: detectedAt });
        madeUnavailable.push(instance.id);
        warnings.push(
          `environment instance "${instance.id}" no longer detected; marked unavailable`,
        );
        this.audit?.record("environment_unavailable", {
          data: { hostId, instanceId: instance.id },
        });
      }
    }
    return madeUnavailable;
  }

  private upsertHost(
    request: DetectHostRequest,
    availability: HostInstance["availability"],
    capabilities: readonly CapabilityDeclaration[],
    detectedAt: string,
  ): HostInstance {
    const existing = this.registry.getHost(request.hostId);
    const host: HostInstance = {
      id: request.hostId,
      hostId: request.hostId,
      name: request.name,
      hostType: request.hostType,
      os: request.os,
      trustLevel: request.trustLevel ?? "detected",
      availability,
      capabilities,
      fingerprint: hostFingerprint({ hostId: request.hostId, os: request.os }),
      lastDetectedAt: detectedAt,
      lastVerifiedAt: existing?.lastVerifiedAt ?? detectedAt,
      lastHealthCheckAt: detectedAt,
      costCenter: request.costCenter,
      safeMetadata: request.safeMetadata,
    };
    this.registry.upsertHost(host);
    if (!existing) {
      this.audit?.record("host_registered", {
        data: { hostId: request.hostId, hostType: request.hostType },
      });
    }
    return host;
  }
}

interface ProbeRun {
  probeId: string;
  detected: DetectedEnvironment;
}
