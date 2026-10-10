import { SupportCase, ServiceLevelAgreement } from "../../contracts/customer.js";
export declare class SupportService {
    private cases;
    private slas;
    registerSLA(sla: ServiceLevelAgreement): void;
    getSLA(planId: string): ServiceLevelAgreement | undefined;
    createCase(customerId: string, title: string, description: string, priority: SupportCase["priority"], category: SupportCase["category"], contactId?: string): SupportCase;
    getCase(caseId: string): SupportCase | undefined;
    getCustomerCases(customerId: string): SupportCase[];
    updateCaseStatus(caseId: string, status: SupportCase["status"]): void;
    escalateCase(caseId: string, newPriority: SupportCase["priority"]): void;
}
