import type { PolicyDefinition, PolicyAcknowledgement } from "../../contracts/policy.js";
export declare class PolicyService {
    private policies;
    private acks;
    createPolicy(p: Omit<PolicyDefinition, "policyId" | "createdAt" | "updatedAt" | "version"> & {
        version?: number;
    }): PolicyDefinition;
    updatePolicy(policyId: string, updates: Partial<PolicyDefinition>): PolicyDefinition;
    newVersion(policyId: string, content?: string, updatedBy?: string): PolicyDefinition;
    getPolicies(orgId?: string): PolicyDefinition[];
    acknowledge(policyId: string, principalId: string, policyVersion: number, orgId?: string): PolicyAcknowledgement;
    getAcknowledgements(policyId: string): PolicyAcknowledgement[];
}
