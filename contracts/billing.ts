export interface CommercialProduct {
  productId: string;
  name: string;
  description: string;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  metadata?: Record<string, string>;
}

export interface EntitlementDefinition {
  entitlementId: string;
  name: string;
  type: "BOOLEAN" | "QUOTA";
  description?: string;
  meterId?: string; // If quota is metered
}

export interface PlanVersion {
  versionId: string;
  planId: string;
  version: number;
  displayName: string;
  status: "DRAFT" | "ACTIVE" | "GRANDFATHERED" | "RETIRED";
  billingCadence: "MONTHLY" | "ANNUAL" | "CUSTOM";
  entitlements: Record<string, any>; // entitlementId -> value (boolean or number)
  priceReferences: string[]; // priceIds
  trialEligibility: boolean;
  metadata?: Record<string, string>;
}

export interface CommercialPlan {
  planId: string;
  productId: string;
  activeVersionId?: string;
}

export interface PriceComponent {
  mode: "FIXED_RECURRING" | "PER_UNIT" | "TIERED" | "USAGE_BASED";
  amountMinorUnits: number; // e.g. cents
  currency: string;
  meterId?: string; // For usage based
  includedUsage?: number; // E.g., 100 free units
  tierBoundaries?: { upTo: number | null; amountMinorUnits: number }[];
}

export interface Price {
  priceId: string;
  planVersionId: string;
  currency: string;
  components: PriceComponent[];
  version: number;
  metadata?: Record<string, string>;
}

export interface BillingAccount {
  billingAccountId: string;
  organizationId: string;
  billingEmail: string;
  billingName: string;
  billingAddress?: any;
  taxProfileRef?: string;
  currency: string;
  providerCustomerRef?: string;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  metadata?: Record<string, string>;
}

export type SubscriptionStatus =
  | "INCOMPLETE"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "GRACE_PERIOD"
  | "RESTRICTED"
  | "CANCELLING"
  | "CANCELLED"
  | "EXPIRED"
  | "ENDED"
  | "UNKNOWN";

export interface Subscription {
  subscriptionId: string;
  organizationId: string;
  billingAccountId: string;
  productId: string;
  planId: string;
  planVersionId: string;
  status: SubscriptionStatus;
  billingCadence: "MONTHLY" | "ANNUAL" | "CUSTOM";
  currency: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialStart?: Date;
  trialEnd?: Date;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: Date;
  endedAt?: Date;
  providerRef?: string;
  metadata?: Record<string, string>;
}

export interface UsageMeter {
  meterId: string;
  name: string;
  dimension: string;
  unit: string;
  version: number;
}

export interface BillableUsage {
  organizationId: string;
  meterId: string;
  periodStart: Date;
  periodEnd: Date;
  observedUsage: number;
  includedUsage: number;
  billableUsage: number;
}

export interface RatedCharge {
  subscriptionId: string;
  meterId?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMinorUnits: number;
  amountMinorUnits: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
}

export type InvoiceStatus = "DRAFT" | "OPEN" | "PAID" | "VOID" | "UNCOLLECTIBLE" | "CANCELLED" | "UNKNOWN";

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMinorUnits: number;
  amountMinorUnits: number;
  sourceType: "SUBSCRIPTION_BASE" | "OVERAGE" | "ADJUSTMENT" | "CREDIT";
  sourceReference?: string;
  meterId?: string;
  periodStart: Date;
  periodEnd: Date;
}

export interface Invoice {
  invoiceId: string;
  organizationId: string;
  billingAccountId: string;
  subscriptionId: string;
  status: InvoiceStatus;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  subtotalMinorUnits: number;
  discountTotalMinorUnits: number;
  taxTotalMinorUnits: number;
  creditTotalMinorUnits: number;
  totalMinorUnits: number;
  amountDueMinorUnits: number;
  amountPaidMinorUnits: number;
  issuedAt?: Date;
  dueAt?: Date;
  paidAt?: Date;
  providerInvoiceRef?: string;
  lineItems: InvoiceLineItem[];
  metadata?: Record<string, string>;
}

export interface PaymentTransaction {
  paymentId: string;
  organizationId: string;
  billingAccountId: string;
  invoiceId?: string;
  provider: string;
  providerPaymentRef: string;
  amountMinorUnits: number;
  currency: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "REFUNDED" | "PARTIALLY_REFUNDED" | "UNKNOWN";
  createdAt: Date;
  updatedAt: Date;
  failureCode?: string;
  metadata?: Record<string, string>;
}

export interface PaymentProviderEvent {
  eventId: string;
  provider: string;
  eventType: string;
  receivedAt: Date;
  verifiedAt?: Date;
  processedAt?: Date;
  status: "PENDING" | "PROCESSED" | "FAILED" | "IGNORED";
  resourceRefs: string[];
  payloadDigest: string;
}

export interface CommercialRestriction {
  organizationId: string;
  reason: "PAST_DUE" | "TRIAL_EXPIRED" | "CANCELLED" | "MANUAL_REVIEW";
  restrictedCapabilities: string[]; // e.g., ["deployments.create", "premium_agents.run"]
}

export interface CommercialAuditRecord {
  id: string;
  organizationId: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: Date;
  details: Record<string, any>;
}

export interface CommercialContractOverride {
  organizationId: string;
  planId: string;
  customPriceMinorUnits?: number;
  customQuotas?: Record<string, number>;
  customEntitlements?: Record<string, boolean>;
  contractStart: Date;
  contractEnd: Date;
  purchaseOrderRef?: string;
}

