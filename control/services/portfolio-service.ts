import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import { ValidationError } from "../../contracts/index.js";
import type {
  StrategicObjective,
  EnterprisePortfolio,
  PortfolioProgram,
} from "../../contracts/portfolio.js";

export class PortfolioControlService {
  constructor(
    private readonly objectives: Repository<StrategicObjective>,
    private readonly portfolios: Repository<EnterprisePortfolio>,
    private readonly programs: Repository<PortfolioProgram>
  ) {}

  private enforceAdmin(operator: OperatorPrincipal) {
    if (operator.role !== "admin") {
      throw new ValidationError("Unauthorized. Requires admin role for Portfolio operations.");
    }
  }

  async listPortfolios(): Promise<EnterprisePortfolio[]> {
    return this.portfolios.list();
  }

  async listPrograms(): Promise<PortfolioProgram[]> {
    return this.programs.list();
  }

  async listObjectives(): Promise<StrategicObjective[]> {
    return this.objectives.list();
  }
}
