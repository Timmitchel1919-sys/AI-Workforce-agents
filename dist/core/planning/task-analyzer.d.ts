/**
 * TaskAnalyzer — deterministic normalization of a validated `ProjectRequest`
 * into structured technical requirements.
 *
 * Input is structured data only; the free-text `summary` is never parsed and
 * no model is called. Unknown or incompatible technologies are reported as
 * structured `UnsupportedTechnology` entries (a planning outcome), not thrown.
 */
import { type ProjectRequest, type TaskAnalysis } from "../../contracts/index.js";
import { TechnologyCatalog, type TechnologyProfile } from "./technology-catalog.js";
export declare class TaskAnalyzer {
    private readonly catalog;
    constructor(catalog?: TechnologyCatalog);
    analyze(request: ProjectRequest): TaskAnalysis;
    profile(technologyId: string): TechnologyProfile | undefined;
}
