import { ComplianceService } from "../compliance/compliance-service.js";
import { RiskService } from "../risk/risk-service.js";
import { TrustService } from "../trust/trust-service.js";
import { PolicyService } from "../policy/policy-service.js";
export declare class GrcService {
    readonly compliance: ComplianceService;
    readonly risk: RiskService;
    readonly trust: TrustService;
    readonly policy: PolicyService;
    constructor(compliance?: ComplianceService, risk?: RiskService, trust?: TrustService, policy?: PolicyService);
}
