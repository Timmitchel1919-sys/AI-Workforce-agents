import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import { ValidationError } from "../../contracts/index.js";
import type {
  OrganizationDepartment,
  WorkforceTeam,
  HumanAgent,
  SkillDefinition,
  ResourceAssignment,
} from "../../contracts/organization.js";

export class WorkforceManagementService {
  constructor(
    private readonly departments: Repository<OrganizationDepartment>,
    private readonly teams: Repository<WorkforceTeam>,
    private readonly agents: Repository<HumanAgent>,
    private readonly skills: Repository<SkillDefinition>,
    private readonly assignments: Repository<ResourceAssignment>
  ) {}

  private enforceAdmin(operator: OperatorPrincipal) {
    if (operator.role !== "admin") {
      throw new ValidationError("Unauthorized. Requires admin role for Workforce operations.");
    }
  }

  async listDepartments(): Promise<OrganizationDepartment[]> {
    return this.departments.list();
  }

  async listTeams(): Promise<WorkforceTeam[]> {
    return this.teams.list();
  }

  async listAgents(): Promise<HumanAgent[]> {
    return this.agents.list();
  }
}
