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
import { formatVersion, validateDetectedEnvironment, } from "../../contracts/index.js";
import { now } from "../shared.js";
import { HostCapabilityDiscovery } from "./capability-discovery.js";
import { environmentFingerprint, hostFingerprint, instanceIdForFingerprint, } from "./fingerprint.js";
export class EnvironmentDetector {
    registry;
    probes;
    audit;
    discovery;
    resolvedClock;
    constructor(registry, probes, audit, options = {}) {
        this.registry = registry;
        this.probes = probes;
        this.audit = audit;
        this.resolvedClock = options.clock ?? now;
        this.discovery = new HostCapabilityDiscovery({
            clock: this.resolvedClock,
        });
    }
    async detect(request) {
        const detectedAt = request.detectedAt ?? this.resolvedClock();
        const warnings = [];
        const sources = [];
        const applicable = this.probes
            .applicable(request.os)
            .filter((probe) => request.probes === undefined || request.probes.includes(probe.id));
        const results = [];
        for (const probe of applicable) {
            try {
                const result = await probe.detect({
                    hostId: request.hostId,
                    os: request.os,
                });
                validateDetectedEnvironment(result);
                results.push({ probeId: probe.id, detected: result });
                for (const warning of result.warnings)
                    warnings.push(warning);
            }
            catch (error) {
                warnings.push(`probe "${probe.id}" failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            sources.push(probe.id);
        }
        const executed = results.map((r) => r.detected);
        const detected = executed.filter((d) => d.detected);
        const reachable = executed.length > 0;
        const hostAvailability = reachable
            ? "available"
            : "unavailable";
        const report = this.discovery.derive(request.hostId, executed, {
            capabilities: request.declaredCapabilities,
            toolchains: request.declaredToolchains,
        }, sources);
        for (const warning of report.warnings) {
            if (!warnings.includes(warning))
                warnings.push(warning);
        }
        const host = this.upsertHost(request, hostAvailability, report.capabilities, detectedAt);
        const registered = [];
        const refreshed = [];
        const detectedFingerprints = new Set();
        for (const env of detected) {
            const fingerprint = environmentFingerprint(request.hostId, env.environmentType, env.version ? formatVersion(env.version) : undefined, env.installation);
            detectedFingerprints.add(fingerprint);
            const descriptor = this.registry.descriptorForType(env.environmentType);
            if (!descriptor) {
                warnings.push(`environment "${env.environmentType}" detected but has no descriptor; not registered`);
                continue;
            }
            const existing = this.registry.findByFingerprint(request.hostId, fingerprint);
            const instance = {
                id: existing?.id ?? instanceIdForFingerprint(fingerprint),
                descriptorId: descriptor.id,
                hostId: request.hostId,
                environmentType: env.environmentType,
                name: descriptor.name,
                version: env.version,
                installation: env.installation,
                availability: env.availability,
                capabilities: this.discovery.derive(request.hostId, [env], { toolchains: request.declaredToolchains }, [env.environmentType]).capabilities,
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
            }
            else {
                registered.push(persisted.id);
                this.audit?.record("environment_discovered", {
                    data: { hostId: request.hostId, descriptorId: descriptor.id },
                });
            }
        }
        const madeUnavailable = this.markMissingInstancesUnavailable(request.hostId, detectedFingerprints, detectedAt, warnings);
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
    markMissingInstancesUnavailable(hostId, stillPresentFingerprints, detectedAt, warnings) {
        const madeUnavailable = [];
        for (const instance of this.registry.instancesForHost(hostId)) {
            if (instance.availability === "available" &&
                !stillPresentFingerprints.has(instance.fingerprint)) {
                this.registry.markInstanceUnavailable(instance.id, { now: detectedAt });
                madeUnavailable.push(instance.id);
                warnings.push(`environment instance "${instance.id}" no longer detected; marked unavailable`);
                this.audit?.record("environment_unavailable", {
                    data: { hostId, instanceId: instance.id },
                });
            }
        }
        return madeUnavailable;
    }
    upsertHost(request, availability, capabilities, detectedAt) {
        const existing = this.registry.getHost(request.hostId);
        const host = {
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
