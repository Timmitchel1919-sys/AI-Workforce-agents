/**
 * TechnologySelector — the EO-1 declarative layer.
 *
 * Selects which ENVIRONMENT DESCRIPTOR (declared support) matches a technology
 * requirement, entirely independent of whether any machine has it installed.
 * It answers "can the workforce support this?" — availability and provisioning
 * belong to the EnvironmentRouter.
 */
import {
  type EnvironmentDescriptor,
  type EnvironmentRequirement,
  validateEnvironmentRequirement,
} from "../../contracts/index.js";
import { EnvironmentRegistry } from "../environments/environment-registry.js";

export type TechnologySelection =
  | { outcome: "SUPPORTED"; descriptor: EnvironmentDescriptor }
  | { outcome: "UNSUPPORTED"; reason: string };

export class TechnologySelector {
  constructor(private readonly registry: EnvironmentRegistry) {}

  select(requirement: EnvironmentRequirement): TechnologySelection {
    if (this.registry.listDescriptors().length === 0) {
      return {
        outcome: "UNSUPPORTED",
        reason: "no environment descriptors are registered",
      };
    }
    validateEnvironmentRequirement(requirement);

    if (requirement.descriptorId !== undefined) {
      const descriptor = this.registry.getDescriptor(requirement.descriptorId);
      return descriptor
        ? { outcome: "SUPPORTED", descriptor }
        : {
            outcome: "UNSUPPORTED",
            reason: `unknown environment descriptor "${requirement.descriptorId}"`,
          };
    }

    if (requirement.environmentType !== undefined) {
      const descriptor = this.registry.descriptorForType(
        requirement.environmentType,
      );
      if (descriptor) return { outcome: "SUPPORTED", descriptor };
    }

    if ((requirement.requiredCapabilities ?? []).length > 0) {
      const offering = this.bestOfferingForCapabilities(
        requirement.requiredCapabilities ?? [],
      );
      if (offering) return { outcome: "SUPPORTED", descriptor: offering };
    }

    if ((requirement.toolchains ?? []).length > 0) {
      const supporting = this.registry
        .listDescriptors()
        .find((descriptor) =>
          requirement.toolchains!.every((req) =>
            descriptor.supportedToolchains.some(
              (supported) => supported.kind === req.kind,
            ),
          ),
        );
      if (supporting) return { outcome: "SUPPORTED", descriptor: supporting };
    }

    return {
      outcome: "UNSUPPORTED",
      reason: "no registered descriptor supports this requirement",
    };
  }

  private bestOfferingForCapabilities(
    capabilities: readonly string[],
  ): EnvironmentDescriptor | undefined {
    let best: EnvironmentDescriptor | undefined;
    let bestCount = 0;
    for (const descriptor of this.registry.listDescriptors()) {
      const offered = (descriptor.declaredCapabilities ??
        []) as readonly string[];
      const count = capabilities.filter((c) => offered.includes(c)).length;
      if (count > bestCount) {
        best = descriptor;
        bestCount = count;
      }
    }
    return best;
  }
}
