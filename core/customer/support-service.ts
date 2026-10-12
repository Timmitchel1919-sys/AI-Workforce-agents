import {
  SupportCase,
  ServiceLevelAgreement,
} from "../../contracts/customer.js";

export class SupportService {
  private cases = new Map<string, SupportCase>();
  private slas = new Map<string, ServiceLevelAgreement>();

  registerSLA(sla: ServiceLevelAgreement) {
    this.slas.set(sla.planId, sla);
  }

  getSLA(planId: string): ServiceLevelAgreement | undefined {
    return this.slas.get(planId);
  }

  createCase(
    customerId: string,
    title: string,
    description: string,
    priority: SupportCase["priority"],
    category: SupportCase["category"],
    contactId?: string,
  ): SupportCase {
    const newCase: SupportCase = {
      caseId: `case_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      customerId,
      contactId,
      title,
      description,
      priority,
      status: "NEW",
      category,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.cases.set(newCase.caseId, newCase);
    return newCase;
  }

  getCase(caseId: string): SupportCase | undefined {
    return this.cases.get(caseId);
  }

  getCustomerCases(customerId: string): SupportCase[] {
    return Array.from(this.cases.values()).filter(
      (c) => c.customerId === customerId,
    );
  }

  updateCaseStatus(caseId: string, status: SupportCase["status"]) {
    const supportCase = this.cases.get(caseId);
    if (!supportCase) throw new Error("Case not found");

    supportCase.status = status;
    supportCase.updatedAt = new Date();
    if (status === "RESOLVED" || status === "CLOSED") {
      supportCase.resolvedAt = new Date();
    }
  }

  escalateCase(caseId: string, newPriority: SupportCase["priority"]) {
    const supportCase = this.cases.get(caseId);
    if (!supportCase) throw new Error("Case not found");
    supportCase.priority = newPriority;
    supportCase.updatedAt = new Date();
  }
}
