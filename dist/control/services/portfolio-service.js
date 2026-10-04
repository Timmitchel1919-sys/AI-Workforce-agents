import { ValidationError } from "../../contracts/index.js";
export class PortfolioControlService {
    objectives;
    portfolios;
    programs;
    constructor(objectives, portfolios, programs) {
        this.objectives = objectives;
        this.portfolios = portfolios;
        this.programs = programs;
    }
    enforceAdmin(operator) {
        if (operator.role !== "admin") {
            throw new ValidationError("Unauthorized. Requires admin role for Portfolio operations.");
        }
    }
    async listPortfolios() {
        return this.portfolios.list();
    }
    async listPrograms() {
        return this.programs.list();
    }
    async listObjectives() {
        return this.objectives.list();
    }
}
