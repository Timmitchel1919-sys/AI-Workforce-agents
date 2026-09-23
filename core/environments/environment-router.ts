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
 */
import {
  type EnvironmentRequirement,
  type EnvironmentRoutingOutcome,
  validateEnvironmentRequirement,
} from "../../contracts/index.js";
import {
  capabilitiesSatisfied,
  satisfiesToolchainRequirements,
} from "./capability-mapping.js";
import { EnvironmentRegistry } from "./environment-registry.js";

export class EnvironmentRouter {
  constructor(private readonly registry: EnvironmentRegistry) {}

  route(requirement: EnvironmentRequirement): EnvironmentRoutingOutcome {
    validateEnvironmentRequirement(requirement);
    if (
      requirement.descriptorId !== undefined &&
      !this.registry.hasDescriptor(requirement.descriptorId)
    ) {
      throw new Error(
        `unknown environment descriptor: ${requirement.descriptorId}`,
      );
    }

    const hostIds = new Set(
      this.registry
        .listHosts()
        .filter((h) => h.availability === "available")
        .map((h) => h.hostId),
    );

    const candidates = this.registry
      .listInstances()
      .filter((instance) => instance.availability === "available")
      .filter((instance) => hostIds.has(instance.hostId))
      .filter(
        (instance) =>
          requirement.descriptorId === undefined ||
          instance.descriptorId === requirement.descriptorId,
      )
      .filter(
        (instance) =>
          requirement.environmentType === undefined ||
          instance.environmentType === requirement.environmentType,
      )
      .filter((instance) =>
        capabilitiesSatisfied(
          requirement.requiredCapabilities ?? [],
          instance.capabilities,
        ),
      )
      .filter((instance) =>
        satisfiesToolchainRequirements(
          requirement.toolchains ?? [],
          instance.toolchains,
        ),
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    if (candidates.length > 0) {
      const instance = candidates[0]!;
      const host = this.registry.getHost(instance.hostId);
      if (host) {
        return { outcome: "ROUTED", instance, host };
      }
    }

    const provisionableDescriptorId =
      requirement.descriptorId ??
      (requirement.environmentType !== undefined
        ? this.registry.descriptorForType(requirement.environmentType)?.id
        : undefined) ??
      firstOfferingCapability(this.registry, requirement);

    if (provisionableDescriptorId !== undefined) {
      return {
        outcome: "REQUIRES_PROVISIONING",
        reason:
          `descriptor "${provisionableDescriptorId}" is supported but no ` +
          "usable environment instance is registered",
        descriptorId: provisionableDescriptorId,
      };
    }

    return {
      outcome: "NO_AVAILABLE_ENVIRONMENT",
      reason: "no registered descriptor can satisfy this requirement",
    };
  }
}

function firstOfferingCapability(
  registry: EnvironmentRegistry,
  requirement: EnvironmentRequirement,
): string | undefined {
  for (const capability of requirement.requiredCapabilities ?? []) {
    const offering = registry.descriptorIdsOfferingCapability(capability)[0];
    if (offering) return offering;
  }
  return undefined;
}
