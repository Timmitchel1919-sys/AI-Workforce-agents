import { type ProjectAdapter } from "../../contracts/index.js";
/**
 * A registry of project integrations, so the Control Plane (and any future
 * multi-project caller) selects a project by id rather than hard-coding one.
 *
 * It holds `ProjectAdapter` *instances* — the concrete adapter (Money Mind,
 * and later AIMS / Mastery / Tripod) is built and registered by the wiring
 * layer. This registry knows nothing project-specific.
 */
export interface ProjectRegistration {
    projectId: string;
    displayName: string;
    adapter: ProjectAdapter;
    metadata: Record<string, unknown>;
}
export interface ProjectRegistrationOptions {
    displayName?: string;
    metadata?: Record<string, unknown>;
}
export declare class ProjectRegistry {
    private readonly projects;
    register(adapter: ProjectAdapter, options?: ProjectRegistrationOptions): ProjectRegistration;
    has(projectId: string): boolean;
    get(projectId: string): ProjectRegistration | undefined;
    require(projectId: string): ProjectRegistration;
    list(): ProjectRegistration[];
    ids(): string[];
}
