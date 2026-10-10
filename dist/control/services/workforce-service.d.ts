import type { Repository } from "../../contracts/persistence.js";
import type { OrganizationDepartment, WorkforceTeam, HumanAgent, SkillDefinition, ResourceAssignment } from "../../contracts/organization.js";
export declare class WorkforceManagementService {
    private readonly departments;
    private readonly teams;
    private readonly agents;
    private readonly skills;
    private readonly assignments;
    constructor(departments: Repository<OrganizationDepartment>, teams: Repository<WorkforceTeam>, agents: Repository<HumanAgent>, skills: Repository<SkillDefinition>, assignments: Repository<ResourceAssignment>);
    private enforceAdmin;
    listDepartments(): Promise<OrganizationDepartment[]>;
    listTeams(): Promise<WorkforceTeam[]>;
    listAgents(): Promise<HumanAgent[]>;
}
