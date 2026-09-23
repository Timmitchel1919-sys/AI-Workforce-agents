/**
 * EnvironmentRegistry — the authoritative store for environment descriptors,
 * registered hosts, and detected environment instances.
 *
 * Registry rules (validated on every write):
 *   - an environment instance references a KNOWN descriptor,
 *   - an instance is OS-compatible with its descriptor (when declared),
 *   - capability declarations and availability are well-formed,
 *   - instance ids are unique and fingerprints de-duplicated,
 *   - no credentials, no secrets, no arbitrary commands.
 *
 * The registry never invents availability: it only persists what a detector
 * reported or what an explicit operational action set.
 */
import { ValidationError, validateEnvironmentDescriptor, validateEnvironmentInstance, validateHostInstance, } from "../../contracts/index.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { now } from "../shared.js";
export class EnvironmentRegistry {
    hosts;
    instances;
    descriptors = new Map();
    clock;
    constructor(options = {}) {
        this.hosts = options.hosts ?? new InMemoryRepository();
        this.instances =
            options.instances ?? new InMemoryRepository();
        this.clock = options.clock ?? now;
    }
    /* ---------------------------------------------------------------- */
    /* Descriptors — the declared support catalog                       */
    /* ---------------------------------------------------------------- */
    registerDescriptor(descriptor) {
        validateEnvironmentDescriptor(descriptor);
        this.descriptors.set(descriptor.id, descriptor);
        return descriptor;
    }
    hasDescriptor(id) {
        return this.descriptors.has(id);
    }
    getDescriptor(id) {
        return this.descriptors.get(id);
    }
    listDescriptors() {
        return [...this.descriptors.values()];
    }
    descriptorForType(type) {
        return [...this.descriptors.values()].find((d) => d.environmentType === type);
    }
    requireDescriptor(id) {
        const found = this.getDescriptor(id);
        if (!found)
            throw new ValidationError(`unknown environment descriptor: ${id}`);
        return found;
    }
    /** Set of descriptor ids whose `declaredCapabilities` include a capability. */
    descriptorIdsOfferingCapability(capability) {
        return [...this.descriptors.values()]
            .filter((d) => d.declaredCapabilities?.includes(capability))
            .map((d) => d.id);
    }
    /* ---------------------------------------------------------------- */
    /* Hosts                                                            */
    /* ---------------------------------------------------------------- */
    upsertHost(host) {
        validateHostInstance(host);
        this.hosts.upsert(host);
        return host;
    }
    getHost(hostId) {
        return this.hosts.findById(hostId);
    }
    listHosts() {
        return this.hosts.list();
    }
    removeHost(hostId) {
        const existing = this.hosts.findById(hostId);
        if (!existing)
            return false;
        this.hosts.delete(hostId);
        for (const instance of this.instancesForHost(hostId)) {
            this.instances.delete(instance.id);
        }
        return true;
    }
    markHostUnavailable(hostId, options = {}) {
        const host = this.hosts.findById(hostId);
        if (!host)
            return undefined;
        return this.upsertHost({
            ...host,
            availability: "unavailable",
            lastHealthCheckAt: options.now ?? this.clock(),
        });
    }
    /* ---------------------------------------------------------------- */
    /* Instances                                                        */
    /* ---------------------------------------------------------------- */
    /**
     * Insert or replace an instance. Validates the registry rules. Throws on a
     * fingerprint that already belongs to a *different* instance id (dedup
     * conflicts surface here; the detector resolves them via `findByFingerprint`
     * before calling).
     */
    upsertInstance(instance) {
        validateEnvironmentInstance(instance);
        const descriptor = this.requireDescriptor(instance.descriptorId);
        const host = this.hosts.findById(instance.hostId);
        if (!host) {
            throw new ValidationError(`unknown host "${instance.hostId}" for environment instance "${instance.id}"`);
        }
        this.assertOsCompatibility(descriptor, host);
        assertNoCredentials(instance);
        const clash = this.findByFingerprint(instance.hostId, instance.fingerprint);
        if (clash && clash.id !== instance.id) {
            throw new ValidationError(`environment instance "${instance.id}" duplicates fingerprint ` +
                `"${instance.fingerprint}" already held by instance "${clash.id}"`);
        }
        this.instances.upsert(instance);
        return instance;
    }
    getInstance(id) {
        return this.instances.findById(id);
    }
    listInstances() {
        return this.instances.list();
    }
    instancesForHost(hostId) {
        return this.instances.list().filter((i) => i.hostId === hostId);
    }
    /** Instances that are usable right now (instance + host both available). */
    usableInstances() {
        const hostIds = new Set(this.listHosts()
            .filter((h) => h.availability === "available")
            .map((h) => h.hostId));
        return this.listInstances().filter((i) => i.availability === "available" && hostIds.has(i.hostId));
    }
    findByFingerprint(hostId, fingerprint) {
        return this.listInstances().find((i) => i.hostId === hostId && i.fingerprint === fingerprint);
    }
    markInstanceUnavailable(instanceId, options = {}) {
        const existing = this.instances.findById(instanceId);
        if (!existing)
            return undefined;
        return this.upsertInstance({
            ...existing,
            availability: "unavailable",
            lastHealthCheckAt: options.now ?? this.clock(),
        });
    }
    removeInstance(id) {
        return this.instances.delete(id);
    }
    /* ---------------------------------------------------------------- */
    /* Validation helpers                                               */
    /* ---------------------------------------------------------------- */
    assertOsCompatibility(descriptor, host) {
        const minimum = descriptor.minimumOs;
        if (!minimum)
            return;
        if (minimum.os !== undefined && minimum.os !== host.os.os) {
            throw new ValidationError(`environment descriptor "${descriptor.id}" requires OS ${minimum.os}; ` +
                `host "${host.hostId}" is ${host.os.os}`);
        }
        if (minimum.architecture !== undefined &&
            minimum.architecture !== host.os.architecture) {
            throw new ValidationError(`environment descriptor "${descriptor.id}" requires architecture ` +
                `${minimum.architecture}; host "${host.hostId}" is ${host.os.architecture}`);
        }
    }
}
/** Belt-and-braces guard: refuse registry records that smuggle secrets in. */
function assertNoCredentials(instance) {
    const joined = JSON.stringify({
        safeMetadata: instance.safeMetadata,
        toolchains: instance.toolchains,
    }).toLowerCase();
    for (const needle of ["apikey", "api_key", "secret", "password", "token"]) {
        if (joined.includes(needle)) {
            throw new ValidationError("environment instance metadata must not contain credential fields");
        }
    }
}
