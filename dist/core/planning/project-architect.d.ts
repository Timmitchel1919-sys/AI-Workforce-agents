/**
 * ProjectArchitect — derives the architecture requirement and the execution
 * ENVIRONMENT requirements from a task analysis.
 *
 * One project is not one environment: each component contributes its own
 * requirement (merged per host OS), and identical requirements from different
 * components are shared. A React + .NET + Android project therefore yields
 * three environment requirements; the architect never collapses them.
 */
import { type ArchitectureRequirement, type EnvironmentRequirement, type TaskAnalysis } from "../../contracts/index.js";
export interface DraftEnvironmentRequirement {
    id: string;
    componentIds: string[];
    requirement: EnvironmentRequirement;
}
export declare class ProjectArchitect {
    architecture(analysis: TaskAnalysis): ArchitectureRequirement;
    /** Environment requirements in request order, deduplicated by content. */
    environmentRequirements(analysis: TaskAnalysis): DraftEnvironmentRequirement[];
}
/** Order-independent key so identical requirements are shared. */
export declare function canonicalKey(value: unknown): string;
export declare function sortKeys(value: unknown): unknown;
