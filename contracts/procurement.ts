import { Entity } from "./persistence.js";

export const VENDOR_LIFECYCLE_STATES = [
  "PROSPECTIVE",
  "UNDER_REVIEW",
  "QUALIFIED",
  "APPROVED",
  "ACTIVE",
  "RESTRICTED",
  "SUSPENDED",
  "OFFBOARDING",
  "INACTIVE"
] as const;
export type VendorLifecycleState = typeof VENDOR_LIFECYCLE_STATES[number];

export const PROCUREMENT_CATEGORIES = [
  "AI_PROVIDER",
  "SOFTWARE",
  "SAAS",
  "CLOUD",
  "DEVELOPER_TOOL",
  "SECURITY_TOOL",
  "DATA_SERVICE",
  "INFRASTRUCTURE",
  "HARDWARE",
  "PROFESSIONAL_SERVICE",
  "CONSULTING",
  "LICENSE",
  "API_SERVICE",
  "OTHER"
] as const;
export type ProcurementCategory = typeof PROCUREMENT_CATEGORIES[number];

export interface Vendor extends Entity {
  vendorId: string;
  organizationId: string;
  legalName: string;
  displayName: string;
  category: ProcurementCategory;
  status: VendorLifecycleState;
  website?: string;
  country?: string;
  riskRef?: string;
  securityReviewRef?: string;
  contractRefs: readonly string[];
  integrationRefs: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export const VENDOR_ONBOARDING_STAGES = [
  "IDENTIFICATION",
  "INFORMATION_COLLECTION",
  "SECURITY_REVIEW",
  "GRC_RISK_REVIEW",
  "COMMERCIAL_REVIEW",
  "APPROVAL",
  "ACTIVATION"
] as const;
export type VendorOnboardingStage = typeof VENDOR_ONBOARDING_STAGES[number];

export interface VendorOnboardingCase extends Entity {
  caseId: string;
  organizationId: string;
  vendorId: string;
  stage: VendorOnboardingStage;
  status: "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "CANCELLED";
  evidenceRefs: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface VendorQualification extends Entity {
  qualificationId: string;
  organizationId: string;
  vendorId: string;
  approvedScope: readonly string[]; // e.g. "public-data", "internal-tools"
  restrictedScope: readonly string[]; // e.g. "restricted-customer-data"
  securityReviewRef?: string;
  riskRef?: string;
  status: "VALID" | "EXPIRED" | "REVOKED";
  expiresAt?: string;
  createdAt: string;
}

export interface ProcurementDemand extends Entity {
  demandId: string;
  organizationId: string;
  sourceType: "PROJECT" | "PRODUCT" | "SERVICE" | "TEAM" | "AGENT_GAP" | "SECURITY" | "FINOPS" | "ITSM";
  sourceRef: string;
  description: string;
  status: "OPEN" | "EVALUATING" | "SATISFIED" | "CANCELLED";
  satisfiedByVendorId?: string;
  createdAt: string;
}

export const PROCUREMENT_REQUEST_STATES = [
  "DRAFT",
  "SUBMITTED",
  "TRIAGE",
  "SOURCING",
  "UNDER_REVIEW",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "ORDERED",
  "FULFILLED",
  "CANCELLED"
] as const;
export type ProcurementRequestState = typeof PROCUREMENT_REQUEST_STATES[number];

export interface ProcurementRequest extends Entity {
  requestId: string;
  organizationId: string;
  requesterRef: string;
  demandRef?: string;
  category: ProcurementCategory;
  description: string;
  businessJustification: string;
  technicalRequirements: readonly string[];
  securityRequirements: readonly string[];
  dataClassification: string;
  estimatedCostMinorUnits?: number;
  currency?: string;
  budgetRef?: string;
  desiredBy?: string;
  status: ProcurementRequestState;
  createdAt: string;
  updatedAt: string;
}

export interface SourcingCase extends Entity {
  sourcingId: string;
  organizationId: string;
  requestId: string;
  method: "EXISTING_VENDOR" | "DIRECT_SOURCE" | "MULTI_VENDOR_COMPARISON" | "RFP_FOUNDATION" | "INTERNAL_CAPABILITY";
  candidateVendorIds: readonly string[];
  evaluationCriteria: readonly string[];
  recommendationVendorId?: string;
  status: "OPEN" | "IN_PROGRESS" | "RECOMMENDED" | "CLOSED";
  createdAt: string;
}

export interface VendorEvaluation extends Entity {
  evaluationId: string;
  organizationId: string;
  sourcingId: string;
  vendorId: string;
  dimensions: {
    capabilityFit: string;
    security: string;
    risk: string;
    technicalCompatibility: string;
    reliabilityEvidence: string;
    cost: string;
    commercialTerms: string;
  };
  tcoMinorUnits?: number;
  currency?: string;
  evaluatorRef: string;
  createdAt: string;
}

export const CONTRACT_STATES = [
  "DRAFT",
  "UNDER_REVIEW",
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTED",
  "ACTIVE",
  "EXPIRING",
  "EXPIRED",
  "TERMINATED",
  "SUPERSEDED"
] as const;
export type ContractState = typeof CONTRACT_STATES[number];

export interface ContractRecord extends Entity {
  contractId: string;
  organizationId: string;
  vendorId: string;
  contractType: string;
  title: string;
  effectiveDate: string;
  expirationDate?: string;
  renewalType: "AUTO" | "MANUAL" | "NONE";
  noticePeriodDays?: number;
  currency: string;
  valueSummaryMinorUnits?: number;
  documentRef?: string;
  version: number;
  supersededByRef?: string;
  status: ContractState;
  ownerRef: string;
  terms: {
    pricing?: string;
    dataHandling?: string;
    liability?: string;
    slaRef?: string;
    extractedByAi?: boolean;
    verified?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ContractObligation extends Entity {
  obligationId: string;
  organizationId: string;
  contractId: string;
  responsibleParty: string;
  obligationType: string;
  description: string;
  dueDate?: string;
  recurrence?: string;
  evidenceRequirement?: string;
  status: "OPEN" | "UPCOMING" | "DUE" | "SATISFIED" | "OVERDUE" | "WAIVED" | "UNKNOWN";
  createdAt: string;
}

export const PO_STATES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "ISSUED",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "CANCELLED",
  "CLOSED"
] as const;
export type PurchaseOrderState = typeof PO_STATES[number];

export interface PurchaseOrder extends Entity {
  poId: string;
  organizationId: string;
  vendorId: string;
  requestId: string;
  contractId?: string;
  currency: string;
  amountMinorUnits: number;
  lineItems: readonly string[];
  status: PurchaseOrderState;
  approvalRef?: string;
  issuedAt?: string;
  createdAt: string;
}

export interface SoftwareLicense extends Entity {
  licenseId: string;
  organizationId: string;
  vendorId: string;
  productName: string;
  licenseType: "PER_SEAT" | "ENTERPRISE" | "USAGE" | "NODE";
  quantity: number;
  assignedQuantity: number;
  availableQuantity: number;
  start: string;
  expiration?: string;
  contractRef?: string;
  costRef?: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  createdAt: string;
}

export const VENDOR_SUBSCRIPTION_STATES = [
  "TRIAL",
  "ACTIVE",
  "PAST_DUE",
  "SUSPENDED",
  "CANCEL_PENDING",
  "CANCELLED",
  "EXPIRED",
  "UNKNOWN"
] as const;
export type VendorSubscriptionState = typeof VENDOR_SUBSCRIPTION_STATES[number];

export interface VendorSubscription extends Entity {
  subscriptionId: string;
  organizationId: string;
  vendorId: string;
  contractId?: string;
  productName: string;
  status: VendorSubscriptionState;
  renewalDate?: string;
  billingCadence: "MONTHLY" | "ANNUAL" | "CUSTOM";
  createdAt: string;
}

export interface RenewalCase extends Entity {
  renewalId: string;
  organizationId: string;
  contractId: string;
  vendorId: string;
  renewalDate: string;
  noticeDeadline: string;
  currentSpendMinorUnits?: number;
  usageEvidenceRef?: string;
  performanceEvidenceRef?: string;
  riskEvidenceRef?: string;
  recommendation?: "RENEW" | "RENEW_WITH_CHANGES" | "RENEGOTIATE" | "REDUCE" | "CONSOLIDATE" | "REPLACE" | "TERMINATE" | "REVIEW_REQUIRED" | "UNKNOWN";
  decision?: string;
  approvalRef?: string;
  status: "OPEN" | "REVIEWING" | "DECIDED" | "ACTIONED";
  createdAt: string;
}

export interface VendorOffboardingPlan extends Entity {
  planId: string;
  organizationId: string;
  vendorId: string;
  contractId?: string;
  tasks: readonly {
    taskId: string;
    description: string;
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  }[];
  status: "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  createdAt: string;
}
