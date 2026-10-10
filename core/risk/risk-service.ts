import type {
  EnterpriseRisk,
  ComplianceException,
  ExceptionState,
  ThirdPartyVendor,
} from "../../contracts/risk.js";
import { createId, now } from "../shared.js";

export class RiskService {
  private risks = new Map<string, EnterpriseRisk>();
  private exceptions = new Map<string, ComplianceException>();
  private vendors = new Map<string, ThirdPartyVendor>();

  createRisk(r: Omit<EnterpriseRisk, "riskId">): EnterpriseRisk {
    const risk: EnterpriseRisk = {
      ...r,
      riskId: createId("risk"),
    };
    this.risks.set(risk.riskId, risk);
    return risk;
  }

  updateRisk(riskId: string, updates: Partial<EnterpriseRisk>): EnterpriseRisk {
    const r = this.risks.get(riskId);
    if (!r) throw new Error("Risk not found");
    Object.assign(r, updates);
    return r;
  }

  getRisks(orgId?: string): EnterpriseRisk[] {
    return Array.from(this.risks.values()).filter(
      (r) => !orgId || r.organizationId === orgId,
    );
  }

  createException(
    e: Omit<ComplianceException, "exceptionId">,
  ): ComplianceException {
    const ex: ComplianceException = {
      ...e,
      exceptionId: createId("ex"),
    };
    this.exceptions.set(ex.exceptionId, ex);
    return ex;
  }

  updateException(
    exceptionId: string,
    status: ExceptionState,
    approvedBy?: string,
  ): ComplianceException {
    const ex = this.exceptions.get(exceptionId);
    if (!ex) throw new Error("Exception not found");
    ex.status = status;
    if (status === "APPROVED" || status === "ACTIVE") {
      ex.approvedAt = now();
      if (approvedBy) ex.approvedBy = approvedBy;
      if (status === "ACTIVE") {
        // mark as active
      }
    }
    if (status === "EXPIRED" || status === "REVOKED") {
      if (status === "REVOKED") ex.revokedAt = now();
    }
    return ex;
  }

  getExceptions(orgId: string): ComplianceException[] {
    return Array.from(this.exceptions.values()).filter(
      (e) => e.organizationId === orgId,
    );
  }

  createVendor(v: Omit<ThirdPartyVendor, "vendorId">): ThirdPartyVendor {
    const vend: ThirdPartyVendor = {
      ...v,
      vendorId: createId("vend"),
    };
    this.vendors.set(vend.vendorId, vend);
    return vend;
  }

  getVendors(orgId?: string): ThirdPartyVendor[] {
    return Array.from(this.vendors.values()).filter(
      (v) => !orgId || v.organizationId === orgId,
    );
  }
}
