import type { ProvisionedProject } from "../../../contracts/onboarding.js";
import { BaseProjectAdapter, type ProjectOperation } from "../project-adapter.js";
/**
 * The project adapter for a project created through onboarding. Like the
 * AI Workforce adapter it REPRESENTS the project and nothing more: one
 * read-only capability returning safe identity, no filesystem, no network,
 * no commands. PROJECT REGISTRATION != EXECUTION.
 */
export declare class ProvisionedProjectAdapter extends BaseProjectAdapter {
    readonly projectId: string;
    protected readonly displayName: string;
    protected readonly operations: Record<string, ProjectOperation>;
    constructor(project: ProvisionedProject);
}
