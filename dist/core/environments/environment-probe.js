/** Ordered registry of probes, filtered per host platform. */
export class ProbeRegistry {
    probes = [];
    register(probe) {
        if (this.probes.some((p) => p.id === probe.id)) {
            throw new Error(`probe already registered: ${probe.id}`);
        }
        this.probes.push(probe);
    }
    list() {
        return [...this.probes];
    }
    /** Every probe applicable to a host platform, in registration order. */
    applicable(os) {
        return this.probes.filter((probe) => probe.supports(os));
    }
    /** Every probe for a specific environment type on a host platform. */
    forType(os, environmentType) {
        return this.applicable(os).filter((probe) => probe.environmentType === environmentType);
    }
}
