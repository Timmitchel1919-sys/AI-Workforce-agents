/**
 * TechnologySelector — the EO-1 declarative layer.
 *
 * Selects which ENVIRONMENT DESCRIPTOR (declared support) matches a technology
 * requirement, entirely independent of whether any machine has it installed.
 * It answers "can the workforce support this?" — availability and provisioning
 * belong to the EnvironmentRouter.
 */
import { type EnvironmentDescriptor, type EnvironmentRequirement } from "../../contracts/index.js";
import { EnvironmentRegistry } from "../environments/environment-registry.js";
export type TechnologySelection = {
    outcome: "SUPPORTED";
    descriptor: EnvironmentDescriptor;
} | {
    outcome: "UNSUPPORTED";
    reason: string;
};
export declare class TechnologySelector {
    private readonly registry;
    constructor(registry: EnvironmentRegistry);
    select(requirement: EnvironmentRequirement): TechnologySelection;
    private bestOfferingForCapabilities;
}
