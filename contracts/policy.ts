/**
 * Policy Management
 */
export const POLICY_STATES = ["DRAFT", "UNDER_REVIEW", "APPROVED", "ACTIVE", "SUPERSEDED", "RETIRED"] as const;
export type PolicyState = (typeof POLICY_STATES)[number];

export interface PolicyDefinition {
  policyId: string;
  title: string;
  purpose: string;
  scope: string;
  owner: string;
  version: number;
  status: PolicyState;
  effectiveAt?: string;
  reviewAt?: string;
  contentRef?: string;
  content?: string;
  controlRefs: readonly string[];
  approvalRef?: string;
  organizationId?: string;
  supersedesPolicyId?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PolicyAcknowledgement {
  ackId: string;
  principalId: string;
  policyId: string;
  policyVersion: number;
  acknowledgedAt: string;
  organizationId?: string;
}
