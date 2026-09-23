import { now } from "../shared.js";
import { deriveEnvironmentCapabilities, } from "./capability-mapping.js";
export class HostCapabilityDiscovery {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    /**
     * @param detected   only executed probes (detected true or false).
     * @param declared   operator-declared capabilities/toolchains (trusted).
     * @param sources    probe ids / declared labels the report was built from.
     */
    derive(hostId, detected, declared = {}, sources = []) {
        const warnings = [];
        for (const env of detected) {
            for (const warning of env.warnings)
                warnings.push(warning);
        }
        return {
            hostId,
            discoveredAt: this.clock(),
            capabilities: deriveEnvironmentCapabilities(detected, declared),
            sources: [...sources],
            warnings,
        };
    }
    clock() {
        return this.options.clock?.() ?? now();
    }
}
