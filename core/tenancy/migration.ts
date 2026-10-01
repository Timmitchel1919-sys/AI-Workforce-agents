import { Organization, Workspace, TenancyStore } from "../../contracts/tenancy.js";
import { ProvisionedProject, ProvisionedProjectStore } from "../../contracts/onboarding.js";
import { Agent } from "../../contracts/index.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { WorkflowSystem } from "../workflows/workflow-system.js";

/**
 * Migration Logic to backfill organizationId on legacy resources.
 */
export class TenancyMigrationService {
  constructor(
    private readonly tenancyStore: TenancyStore,
    private readonly projectStore: ProvisionedProjectStore,
    private readonly agentRegistry: AgentRegistry,
    private readonly workflowSystem: WorkflowSystem
  ) {}

  public async runMigration(defaultOrgId: string, defaultWorkspaceId: string): Promise<void> {
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

