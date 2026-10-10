import { TenancyStore } from "../../contracts/tenancy.js";
import { ProvisionedProjectStore } from "../../contracts/onboarding.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { WorkflowSystem } from "../workflows/workflow-system.js";
/**
 * Migration Logic to backfill organizationId on legacy resources.
 */
export declare class TenancyMigrationService {
    private readonly tenancyStore;
    private readonly projectStore;
    private readonly agentRegistry;
    private readonly workflowSystem;
    constructor(tenancyStore: TenancyStore, projectStore: ProvisionedProjectStore, agentRegistry: AgentRegistry, workflowSystem: WorkflowSystem);
    runMigration(defaultOrgId: string, defaultWorkspaceId: string): Promise<void>;
}
