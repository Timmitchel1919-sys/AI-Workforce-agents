import type { EnterpriseRisk, ComplianceException, ExceptionState, ThirdPartyVendor } from "../../contracts/risk.js";
export declare class RiskService {
    private risks;
    private exceptions;
    private vendors;
    createRisk(r: Omit<EnterpriseRisk, "riskId">): EnterpriseRisk;
    updateRisk(riskId: string, updates: Partial<EnterpriseRisk>): EnterpriseRisk;
    getRisks(orgId?: string): EnterpriseRisk[];
    createException(e: Omit<ComplianceException, "exceptionId">): ComplianceException;
    updateException(exceptionId: string, status: ExceptionState, approvedBy?: string): ComplianceException;
    getExceptions(orgId: string): ComplianceException[];
    createVendor(v: Omit<ThirdPartyVendor, "vendorId">): ThirdPartyVendor;
    getVendors(orgId?: string): ThirdPartyVendor[];
}
