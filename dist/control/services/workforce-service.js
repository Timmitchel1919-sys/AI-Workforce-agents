import { ValidationError } from "../../contracts/index.js";
export class WorkforceManagementService {
    departments;
    teams;
    agents;
    skills;
    assignments;
    constructor(departments, teams, agents, skills, assignments) {
        this.departments = departments;
        this.teams = teams;
        this.agents = agents;
        this.skills = skills;
        this.assignments = assignments;
    }
    enforceAdmin(operator) {
        if (operator.role !== "admin") {
            throw new ValidationError("Unauthorized. Requires admin role for Workforce operations.");
        }
    }
    async listDepartments() {
        return this.departments.list();
    }
    async listTeams() {
        return this.teams.list();
    }
    async listAgents() {
        return this.agents.list();
    }
}
