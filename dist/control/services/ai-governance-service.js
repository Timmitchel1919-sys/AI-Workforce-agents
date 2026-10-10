import { ValidationError } from "../../contracts/index.js";
export class AIGovernanceControlService {
    models;
    useCases;
    evaluations;
    incidents;
    constructor(models, useCases, evaluations, incidents) {
        this.models = models;
        this.useCases = useCases;
        this.evaluations = evaluations;
        this.incidents = incidents;
    }
    enforceGovernanceAdmin(operator) {
        if (operator.role !== "admin") {
            throw new ValidationError("Unauthorized. Requires admin role for AI Governance operations.");
        }
    }
    async listModels() {
        return this.models.list();
    }
    async listUseCases(organizationId) {
        return (await this.useCases.list()).filter((uc) => uc.organizationId === organizationId);
    }
    async registerUseCase(operator, useCase) {
        this.enforceGovernanceAdmin(operator);
        const newUseCase = {
            ...useCase,
            id: `ai_uc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            useCaseId: `ai_uc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            status: "PROPOSED",
            createdAt: new Date().toISOString(),
        };
        this.useCases.upsert(newUseCase);
        return newUseCase;
    }
    async approveUseCase(operator, useCaseId) {
        this.enforceGovernanceAdmin(operator);
        const existing = (await this.useCases.list()).find(u => u.useCaseId === useCaseId);
        if (!existing)
            throw new ValidationError("Use case not found");
        existing.status = "APPROVED";
        this.useCases.upsert(existing);
    }
    async reportIncident(operator, incident) {
        const newIncident = {
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
