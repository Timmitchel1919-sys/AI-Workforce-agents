export class SupportService {
    cases = new Map();
    slas = new Map();
    registerSLA(sla) {
        this.slas.set(sla.planId, sla);
    }
    getSLA(planId) {
        return this.slas.get(planId);
    }
    createCase(customerId, title, description, priority, category, contactId) {
        const newCase = {
            caseId: `case_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            customerId,
            contactId,
            title,
            description,
            priority,
            status: "NEW",
            category,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.cases.set(newCase.caseId, newCase);
        return newCase;
    }
    getCase(caseId) {
        return this.cases.get(caseId);
    }
    getCustomerCases(customerId) {
        return Array.from(this.cases.values()).filter(c => c.customerId === customerId);
    }
    updateCaseStatus(caseId, status) {
        const supportCase = this.cases.get(caseId);
        if (!supportCase)
            throw new Error("Case not found");
        supportCase.status = status;
        supportCase.updatedAt = new Date();
        if (status === "RESOLVED" || status === "CLOSED") {
            supportCase.resolvedAt = new Date();
        }
    }
    escalateCase(caseId, newPriority) {
        const supportCase = this.cases.get(caseId);
        if (!supportCase)
            throw new Error("Case not found");
        supportCase.priority = newPriority;
        supportCase.updatedAt = new Date();
    }
}
