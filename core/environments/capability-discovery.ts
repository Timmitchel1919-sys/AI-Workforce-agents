/**
 * HostCapabilityDiscovery — turns detection facts into a typed, safe
 * `CapabilityReport`. The capability set is derived deterministically from
 * probe outcomes and declared facts; it is never inferred from the OS.
 */
import type {
  CapabilityReport,
  DetectedEnvironment,
} from "../../contracts/index.js";
import { now } from "../shared.js";
import {
  type DeclaredFacts,
  deriveEnvironmentCapabilities,
} from "./capability-mapping.js";

export interface CapabilityDiscoveryOptions {
  clock?: () => string;
}

export class HostCapabilityDiscovery {
  constructor(private readonly options: CapabilityDiscoveryOptions = {}) {}

  /**
   * @param detected   only executed probes (detected true or false).
   * @param declared   operator-declared capabilities/toolchains (trusted).
   * @param sources    probe ids / declared labels the report was built from.
   */
  derive(
    hostId: string,
    detected: readonly DetectedEnvironment[],
    declared: DeclaredFacts = {},
    sources: readonly string[] = [],
  ): CapabilityReport {
    const warnings: string[] = [];
    for (const env of detected) {
      for (const warning of env.warnings) warnings.push(warning);
    }
    return {
      hostId,
      discoveredAt: this.clock(),
      capabilities: deriveEnvironmentCapabilities(detected, declared),
      sources: [...sources],
      warnings,
    };
  }

  private clock(): string {
    return this.options.clock?.() ?? now();
  }
}
