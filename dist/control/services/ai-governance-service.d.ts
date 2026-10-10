import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import type { AIModelRecord, AIUseCase, ModelEvaluation, AIIncident } from "../../contracts/ai-governance.js";
export declare class AIGovernanceControlService {
    private readonly models;
    private readonly useCases;
    private readonly evaluations;
    private readonly incidents;
    constructor(models: Repository<AIModelRecord>, useCases: Repository<AIUseCase>, evaluations: Repository<ModelEvaluation>, incidents: Repository<AIIncident>);
    private enforceGovernanceAdmin;
    listModels(): Promise<AIModelRecord[]>;
    listUseCases(organizationId: string): Promise<AIUseCase[]>;
    registerUseCase(operator: OperatorPrincipal, useCase: Omit<AIUseCase, "id" | "useCaseId" | "status" | "createdAt">): Promise<AIUseCase>;
    approveUseCase(operator: OperatorPrincipal, useCaseId: string): Promise<void>;
    reportIncident(operator: OperatorPrincipal, incident: Omit<AIIncident, "id" | "incidentId" | "status" | "createdAt">): Promise<AIIncident>;
}
