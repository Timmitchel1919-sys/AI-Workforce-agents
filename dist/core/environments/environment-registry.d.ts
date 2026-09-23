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
import { EnvironmentDescriptor, EnvironmentInstance, HostInstance, Repository, type CapabilityDeclaration, type EnvironmentType } from "../../contracts/index.js";
export interface EnvironmentRegistryOptions {
    hosts?: Repository<HostInstance>;
    instances?: Repository<EnvironmentInstance>;
    clock?: () => string;
}
export declare class EnvironmentRegistry {
    private readonly hosts;
    private readonly instances;
    private readonly descriptors;
    private readonly clock;
    constructor(options?: EnvironmentRegistryOptions);
    registerDescriptor(descriptor: EnvironmentDescriptor): EnvironmentDescriptor;
    hasDescriptor(id: string): boolean;
    getDescriptor(id: string): EnvironmentDescriptor | undefined;
    listDescriptors(): EnvironmentDescriptor[];
    descriptorForType(type: EnvironmentType): EnvironmentDescriptor | undefined;
    requireDescriptor(id: string): EnvironmentDescriptor;
    /** Set of descriptor ids whose `declaredCapabilities` include a capability. */
    descriptorIdsOfferingCapability(capability: CapabilityDeclaration["capability"]): string[];
    upsertHost(host: HostInstance): HostInstance;
    getHost(hostId: string): HostInstance | undefined;
    listHosts(): HostInstance[];
    removeHost(hostId: string): boolean;
    markHostUnavailable(hostId: string, options?: {
        now?: string;
    }): HostInstance | undefined;
    /**
     * Insert or replace an instance. Validates the registry rules. Throws on a
     * fingerprint that already belongs to a *different* instance id (dedup
     * conflicts surface here; the detector resolves them via `findByFingerprint`
     * before calling).
     */
    upsertInstance(instance: EnvironmentInstance): EnvironmentInstance;
    getInstance(id: string): EnvironmentInstance | undefined;
    listInstances(): EnvironmentInstance[];
    instancesForHost(hostId: string): EnvironmentInstance[];
    /** Instances that are usable right now (instance + host both available). */
    usableInstances(): EnvironmentInstance[];
    findByFingerprint(hostId: string, fingerprint: string): EnvironmentInstance | undefined;
    markInstanceUnavailable(instanceId: string, options?: {
        now?: string;
    }): EnvironmentInstance | undefined;
    removeInstance(id: string): boolean;
    private assertOsCompatibility;
}
