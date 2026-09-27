import { BaseProjectAdapter, } from "../project-adapter.js";
/**
 * The project adapter for a project created through onboarding. Like the
 * AI Workforce adapter it REPRESENTS the project and nothing more: one
 * read-only capability returning safe identity, no filesystem, no network,
 * no commands. PROJECT REGISTRATION != EXECUTION.
 */
export class ProvisionedProjectAdapter extends BaseProjectAdapter {
    projectId;
    displayName;
    operations;
    constructor(project) {
        super();
        this.projectId = project.id;
        this.displayName = project.displayName;
        const repository = project.repository
            ? { ...project.repository }
            : undefined;
        this.operations = {
            READ_PROJECT: {
                capability: {
                    operation: "READ_PROJECT",
                    description: "Read the project's identity, readiness and repository reference.",
                    action: "read",
                },
                handler: () => ({
                    projectId: project.id,
                    code: project.code,
                    name: project.displayName,
                    description: project.description,
                    readiness: project.readiness,
                    repository,
                }),
            },
        };
    }
}
