import type {
  PolicyDefinition,
  PolicyAcknowledgement,
} from "../../contracts/policy.js";
import { createId, now } from "../shared.js";

export class PolicyService {
  private policies = new Map<string, PolicyDefinition>();
  private acks = new Map<string, PolicyAcknowledgement>();

  createPolicy(
    p: Omit<
      PolicyDefinition,
      "policyId" | "createdAt" | "updatedAt" | "version"
    > & { version?: number },
  ): PolicyDefinition {
    const pol: PolicyDefinition = {
      ...p,
      policyId: createId("pol"),
      version: p.version ?? 1,
      createdAt: now(),
      updatedAt: now(),
    };
    this.policies.set(pol.policyId, pol);
    return pol;
  }

  updatePolicy(
    policyId: string,
    updates: Partial<PolicyDefinition>,
  ): PolicyDefinition {
    const p = this.policies.get(policyId);
    if (!p) throw new Error("Policy not found");
    Object.assign(p, updates);
    p.updatedAt = now();
    return p;
  }

  newVersion(
    policyId: string,
    content?: string,
    updatedBy?: string,
  ): PolicyDefinition {
    const p = this.policies.get(policyId);
    if (!p) throw new Error("Policy not found");
    const newPol: PolicyDefinition = {
      ...p,
      policyId: createId("pol"),
      version: p.version + 1,
      status: "DRAFT",
      content: content ?? p.content,
      supersedesPolicyId: p.policyId,
      createdAt: now(),
      updatedAt: now(),
      updatedBy: updatedBy ?? p.updatedBy,
    };
    this.policies.set(newPol.policyId, newPol);
    return newPol;
  }

  getPolicies(orgId?: string): PolicyDefinition[] {
    return Array.from(this.policies.values()).filter(
      (p) => !orgId || p.organizationId === orgId,
    );
  }

  acknowledge(
    policyId: string,
    principalId: string,
    policyVersion: number,
    orgId?: string,
  ): PolicyAcknowledgement {
    const ack: PolicyAcknowledgement = {
      ackId: createId("ack"),
      principalId,
      policyId,
      policyVersion,
      acknowledgedAt: now(),
      organizationId: orgId,
    };
    this.acks.set(ack.ackId, ack);
    return ack;
  }

  getAcknowledgements(policyId: string): PolicyAcknowledgement[] {
    return Array.from(this.acks.values()).filter(
      (a) => a.policyId === policyId,
    );
  }
}
