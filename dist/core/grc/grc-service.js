import { ComplianceService } from "../compliance/compliance-service.js";
import { RiskService } from "../risk/risk-service.js";
import { TrustService } from "../trust/trust-service.js";
import { PolicyService } from "../policy/policy-service.js";
export class GrcService {
    compliance;
    risk;
    trust;
    policy;
    constructor(compliance = new ComplianceService(), risk = new RiskService(), trust = new TrustService(), policy = new PolicyService()) {
        this.compliance = compliance;
        this.risk = risk;
        this.trust = trust;
        this.policy = policy;
    }
}
