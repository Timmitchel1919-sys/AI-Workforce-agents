import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import { ValidationError } from "../../contracts/index.js";
import type {
  AIModelRecord,
  AIUseCase,
  ModelEvaluation,
  AIIncident,
} from "../../contracts/ai-governance.js";

export class AIGovernanceControlService {
  constructor(
    private readonly models: Repository<AIModelRecord>,
    private readonly useCases: Repository<AIUseCase>,
    private readonly evaluations: Repository<ModelEvaluation>,
    private readonly incidents: Repository<AIIncident>
  ) {}

  private enforceGovernanceAdmin(operator: OperatorPrincipal) {
    if (operator.role !== "admin") {
      throw new ValidationError("Unauthorized. Requires admin role for AI Governance operations.");
    }
  }

  async listModels(): Promise<AIModelRecord[]> {
    return this.models.list();
  }

  async listUseCases(organizationId: string): Promise<AIUseCase[]> {
    return (await this.useCases.list()).filter((uc) => uc.organizationId === organizationId);
  }

  async registerUseCase(
    operator: OperatorPrincipal,
    useCase: Omit<AIUseCase, "id" | "useCaseId" | "status" | "createdAt">
  ): Promise<AIUseCase> {
    this.enforceGovernanceAdmin(operator);
    
    const newUseCase: AIUseCase = {
      ...useCase,
      id: `ai_uc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      useCaseId: `ai_uc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      status: "PROPOSED",
      createdAt: new Date().toISOString(),
    };
    
    this.useCases.upsert(newUseCase);
    return newUseCase;
  }

  async approveUseCase(operator: OperatorPrincipal, useCaseId: string): Promise<void> {
    this.enforceGovernanceAdmin(operator);
    const existing = (await this.useCases.list()).find(u => u.useCaseId === useCaseId);
    if (!existing) throw new ValidationError("Use case not found");
    
    existing.status = "APPROVED";
    this.useCases.upsert(existing);
  }

  async reportIncident(
    operator: OperatorPrincipal,
    incident: Omit<AIIncident, "id" | "incidentId" | "status" | "createdAt">
  ): Promise<AIIncident> {
    const newIncident: AIIncident = {
      ...incident,
      id: `ai_inc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      incidentId: `ai_inc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };
    this.incidents.upsert(newIncident);
    return newIncident;
  }
}
