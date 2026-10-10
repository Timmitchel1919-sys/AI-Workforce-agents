/**
 * EnvironmentRouter — routes a build/execution requirement to a REAL, currently
 * usable environment instance. Routing never fabricates: an "Xcode" environment
 * that nobody detected is never routed to, even if a descriptor exists.
 *
 * Outcomes:
 *   - ROUTED                a real instance + host are usable right now,
 *   - REQUIRES_PROVISIONING the workforce declares support, but no usable
 *                           instance exists yet,
 *   - NO_AVAILABLE_ENVIRONMENT no descriptor supports the requirement.
 *
 * `evaluate()` (EO-3.1) returns the same outcome plus structured evidence for
 * every registered instance — why it was eligible or rejected — so planning
 * decisions are explainable. Selection among eligible instances is
 * deterministic: trust level (verified > detected > declared), then environment
 * version (higher first), then instance id (ascending). No scoring.
 */
import { compareVersions, validateEnvironmentRequirement, } from "../../contracts/index.js";
import { toolchainShortfalls } from "./capability-mapping.js";
const TRUST_RANK = {
    declared: 0,
    detected: 1,
    verified: 2,
};
export const ENVIRONMENT_TIE_BREAK = [
    "trust_level_desc",
    "environment_version_desc",
    "instance_id_asc",
];
export class EnvironmentRouter {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    route(requirement) {
        const evidence = this.evaluate(requirement);
        if (evidence.selectedInstanceId !== undefined) {
            const instance = this.registry.getInstance(evidence.selectedInstanceId);
            const host = instance && this.registry.getHost(instance.hostId);
            if (instance && host)
                return { outcome: "ROUTED", instance, host };
        }
        if (evidence.outcome === "REQUIRES_PROVISIONING" &&
            evidence.supportingDescriptorId !== undefined) {
            return {
                outcome: "REQUIRES_PROVISIONING",
                reason: `descriptor "${evidence.supportingDescriptorId}" is supported but no ` +
                    "usable environment instance is registered",
                descriptorId: evidence.supportingDescriptorId,
            };
        }
        return {
            outcome: "NO_AVAILABLE_ENVIRONMENT",
            reason: "no registered descriptor can satisfy this requirement",
        };
    }
    /** Explainable evaluation of a requirement against every instance. */
    evaluate(requirement) {
        validateEnvironmentRequirement(requirement);
        if (requirement.descriptorId !== undefined &&
            !this.registry.hasDescriptor(requirement.descriptorId)) {
            throw new Error(`unknown environment descriptor: ${requirement.descriptorId}`);
        }
        const hosts = new Map(this.registry.listHosts().map((h) => [h.hostId, h]));
        const evaluated = this.registry
            .listInstances()
            .map((instance) => ({
            instance,
            evidence: evaluateInstance(requirement, instance, hosts.get(instance.hostId)),
        }))
            .sort((a, b) => a.instance.id.localeCompare(b.instance.id));
        const eligible = evaluated
            .filter((entry) => entry.evidence.eligible)
            .map((entry) => entry.instance)
            .sort(compareCandidates);
        const selected = eligible[0];
        const supportingDescriptorId = provisionableDescriptorId(this.registry, requirement);
        return {
            outcome: selected
                ? "ROUTED"
                : supportingDescriptorId !== undefined
                    ? "REQUIRES_PROVISIONING"
                    : "NO_AVAILABLE_ENVIRONMENT",
            selectedInstanceId: selected?.id,
            selectedHostId: selected?.hostId,
            supportingDescriptorId: selected?.descriptorId ?? supportingDescriptorId,
            candidates: evaluated.map((entry) => entry.evidence),
            tieBreak: ENVIRONMENT_TIE_BREAK,
        };
    }
}
function evaluateInstance(requirement, instance, host) {
    const reasons = [];
    if (instance.availability !== "available") {
        reasons.push("instance_unavailable");
    }
    if (!host)
        reasons.push("host_unknown");
    else if (host.availability !== "available")
        reasons.push("host_unavailable");
    if (requirement.descriptorId !== undefined &&
        instance.descriptorId !== requirement.descriptorId) {
        reasons.push("descriptor_mismatch");
    }
    if (requirement.environmentType !== undefined &&
        instance.environmentType !== requirement.environmentType) {
        reasons.push("environment_type_mismatch");
    }
    if (host && requirement.os?.os !== undefined) {
        if (host.os.os !== requirement.os.os)
            reasons.push("os_mismatch");
    }
    if (host && requirement.os?.architecture !== undefined) {
        if (host.os.architecture !== requirement.os.architecture) {
            reasons.push("architecture_mismatch");
        }
    }
    if (requirement.minimumTrust !== undefined &&
        TRUST_RANK[instance.trustLevel] < TRUST_RANK[requirement.minimumTrust]) {
        reasons.push("trust_too_low");
    }
    const available = new Set(instance.capabilities.filter((c) => c.available).map((c) => c.capability));
    const required = requirement.requiredCapabilities ?? [];
    const matchedCapabilities = required.filter((c) => available.has(c));
    const missingCapabilities = required.filter((c) => !available.has(c));
    if (missingCapabilities.length > 0)
        reasons.push("missing_capability");
    const shortfalls = toolchainShortfalls(requirement.toolchains ?? [], instance.toolchains);
    for (const shortfall of shortfalls) {
        if (!reasons.includes(shortfall.reason))
            reasons.push(shortfall.reason);
    }
    return {
        instanceId: instance.id,
        hostId: instance.hostId,
        descriptorId: instance.descriptorId,
        environmentType: instance.environmentType,
        trustLevel: instance.trustLevel,
        eligible: reasons.length === 0,
        reasonCodes: reasons,
        matchedCapabilities,
        missingCapabilities,
        missingToolchains: shortfalls.map((s) => s.label),
    };
}
function compareCandidates(a, b) {
    const trust = TRUST_RANK[b.trustLevel] - TRUST_RANK[a.trustLevel];
    if (trust !== 0)
        return trust;
    const version = compareVersions(b.version, a.version);
    if (version !== 0)
        return version;
    return a.id.localeCompare(b.id);
}
function provisionableDescriptorId(registry, requirement) {
    if (requirement.descriptorId !== undefined)
        return requirement.descriptorId;
    if (requirement.environmentType !== undefined) {
        const byType = registry.descriptorForType(requirement.environmentType)?.id;
        if (byType !== undefined)
            return byType;
    }
    for (const capability of requirement.requiredCapabilities ?? []) {
        const offering = registry.descriptorIdsOfferingCapability(capability)[0];
        if (offering)
            return offering;
    }
    return undefined;
}
