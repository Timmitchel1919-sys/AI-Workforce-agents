/**
 * Migration Logic to backfill organizationId on legacy resources.
 */
export class TenancyMigrationService {
    tenancyStore;
    projectStore;
    agentRegistry;
    workflowSystem;
    constructor(tenancyStore, projectStore, agentRegistry, workflowSystem) {
        this.tenancyStore = tenancyStore;
        this.projectStore = projectStore;
        this.agentRegistry = agentRegistry;
        this.workflowSystem = workflowSystem;
    }
    async runMigration(defaultOrgId, defaultWorkspaceId) {
        // 1. Ensure Default Org exists
        let org = await this.tenancyStore.getOrganization(defaultOrgId);
        if (!org) {
            org = await this.tenancyStore.createOrganization({
                id: defaultOrgId,
                name: "Default Organization",
                slug: "default",
                billingPlan: "enterprise",
                quotas: { maxProjects: -1, maxAgents: -1, maxWorkspaces: -1 },
                status: "active",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
        }
        // 2. Ensure Default Workspace exists
        let ws = await this.tenancyStore.getWorkspace(defaultWorkspaceId);
        if (!ws) {
            ws = await this.tenancyStore.createWorkspace({
                id: defaultWorkspaceId,
                organizationId: defaultOrgId,
                name: "Default Workspace",
                status: "active",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
        }
        // 3. Migrate Projects
        const projects = await this.projectStore.list();
        for (const project of projects) {
            if (!project.organizationId) {
                project.organizationId = defaultOrgId;
                project.workspaceId = defaultWorkspaceId;
                await this.projectStore.replace(project, project.revision);
            }
        }
        // 4. Migrate Agents & Workflows
        // Assuming the persistent stores for agents and workflows will also be migrated similarly.
        const agents = this.agentRegistry.list();
        for (const agent of agents) {
            if (!agent.organizationId) {
                agent.organizationId = defaultOrgId;
                agent.workspaceId = defaultWorkspaceId;
            }
        }
        const workflows = this.workflowSystem.list();
        for (const wf of workflows) {
            if (!wf.organizationId) {
                wf.organizationId = defaultOrgId;
                wf.workspaceId = defaultWorkspaceId;
            }
        }
    }
}
