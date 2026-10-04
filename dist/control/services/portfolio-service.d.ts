import type { Repository } from "../../contracts/persistence.js";
import type { StrategicObjective, EnterprisePortfolio, PortfolioProgram } from "../../contracts/portfolio.js";
export declare class PortfolioControlService {
    private readonly objectives;
    private readonly portfolios;
    private readonly programs;
    constructor(objectives: Repository<StrategicObjective>, portfolios: Repository<EnterprisePortfolio>, programs: Repository<PortfolioProgram>);
    private enforceAdmin;
    listPortfolios(): Promise<EnterprisePortfolio[]>;
    listPrograms(): Promise<PortfolioProgram[]>;
    listObjectives(): Promise<StrategicObjective[]>;
}
