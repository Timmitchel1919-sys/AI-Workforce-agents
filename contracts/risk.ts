/**
 * Enterprise Risk Management
 */
export const RISK_CATEGORIES = [
  "SECURITY",
  "PRIVACY",
  "OPERATIONAL",
  "COMPLIANCE",
  "VENDOR",
  "AI",
  "FINANCIAL",
  "REPUTATIONAL",
  "STRATEGIC",
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const RISK_LIKELIHOODS = [
  "VERY_LOW",
  "LOW",
  "MEDIUM",
  "HIGH",
  "VERY_HIGH",
] as const;
export type RiskLikelihood = (typeof RISK_LIKELIHOODS)[number];

export const RISK_IMPACTS = [
  "VERY_LOW",
  "LOW",
  "MEDIUM",
  "HIGH",
  "VERY_HIGH",
] as const;
export type RiskImpact = (typeof RISK_IMPACTS)[number];

export const RISK_STATES = [
  "IDENTIFIED",
  "ASSESSED",
  "TREATMENT_PLANNED",
  "MITIGATING",
  "MONITORING",
  "ACCEPTED",
  "CLOSED",
] as const;
export type RiskState = (typeof RISK_STATES)[number];

export const RISK_TREATMENTS = [
  "MITIGATE",
  "AVOID",
  "TRANSFER",
  "ACCEPT",
] as const;
export type RiskTreatment = (typeof RISK_TREATMENTS)[number];

export interface EnterpriseRisk {
  riskId: string;
  organizationId?: string;
  projectId?: string;
  title: string;
  description: string;
  category: RiskCategory;
  source: string;
  assetResourceRefs: readonly string[];
  likelihood: RiskLikelihood;
  impact: RiskImpact;
  inherentRisk: RiskImpact | RiskLikelihood;
  residualRisk?: RiskImpact | RiskLikelihood;
  controlRefs: readonly string[];
  owner: string;
  status: RiskState;
  treatment?: RiskTreatment;
  treatmentPlan?: string;
  reviewAt?: string;
  acceptedAt?: string;
  acceptedBy?: string;
  acceptanceReason?: string;
  acceptanceExpiresAt?: string;
  evidenceRefs: readonly string[];
  closedAt?: string;
  metadata?: Record<string, unknown>;
}

export const EXCEPTION_STATES = [
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "REJECTED",
  "CLOSED",
] as const;
export type ExceptionState = (typeof EXCEPTION_STATES)[number];

export interface ComplianceException {
  exceptionId: string;
  organizationId: string;
  controlId?: string;
  policyId?: string;
  scope: string;
  reason: string;
  riskRef?: string;
  requestedBy: string;
  approvedBy?: string;
  startsAt: string;
  expiresAt?: string;
  compensatingControls: readonly string[];
  status: ExceptionState;
  approvedAt?: string;
  revokedAt?: string;
  metadata?: Record<string, unknown>;
}

export const VENDOR_CRITICALITY = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
export type VendorCriticality = (typeof VENDOR_CRITICALITY)[number];

export interface ThirdPartyVendor {
  vendorId: string;
  organizationId?: string;
  name: string;
  service: string;
  dataAccessLevel: "NONE" | "LIMITED" | "MODERATE" | "EXTENSIVE";
  criticality: VendorCriticality;
  securityReviewStatus:
    "NOT_REVIEWED" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED";
  privacyReviewStatus:
    "NOT_REVIEWED" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED";
  contractStatus?: "NO_CONTRACT" | "DRAFT" | "ACTIVE" | "EXPIRED";
  dpaExists?: boolean;
  subprocessorsKnown?: boolean;
  riskRefs: readonly string[];
  evidenceRefs: readonly string[];
  reviewAt?: string;
  approvedAt?: string;
  metadata?: Record<string, unknown>;
}
