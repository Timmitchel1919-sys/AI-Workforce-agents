import { ComplianceService } from "../compliance/compliance-service.js";
import { RiskService } from "../risk/risk-service.js";
import { TrustService } from "../trust/trust-service.js";
import { PolicyService } from "../policy/policy-service.js";

export class GrcService {
  constructor(
    public readonly compliance = new ComplianceService(),
    public readonly risk = new RiskService(),
    public readonly trust = new TrustService(),
    public readonly policy = new PolicyService(),
  ) {}
}
