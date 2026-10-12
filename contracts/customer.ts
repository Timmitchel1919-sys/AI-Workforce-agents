export interface CustomerProfile {
  customerId: string;
  organizationId: string;
  name: string;
  industry?: string;
  size?: "SMB" | "MID_MARKET" | "ENTERPRISE";
  lifecycleStage: "PROSPECT" | "ONBOARDING" | "ACTIVE" | "AT_RISK" | "CHURNED";
  healthScore: number; // 0-100
  successManagerId?: string;
  metadata?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerContact {
  contactId: string;
  customerId: string;
  name: string;
  email: string;
  role: "EXECUTIVE_SPONSOR" | "ADMIN" | "BILLING" | "TECHNICAL" | "USER";
  isPrimary: boolean;
}

export interface SupportCase {
  caseId: string;
  customerId: string;
  contactId?: string;
  title: string;
  description: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "NEW" | "OPEN" | "PENDING_CUSTOMER" | "RESOLVED" | "CLOSED";
  category: "BILLING" | "TECHNICAL" | "FEATURE_REQUEST" | "BUG" | "GENERAL";
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
}

export interface SuccessPlan {
  planId: string;
  customerId: string;
  objectives: string[];
  metrics: string[];
  reviewDate: Date;
  status: "DRAFT" | "ACTIVE" | "ACHIEVED" | "MISSED";
}

export interface ServiceLevelAgreement {
  slaId: string;
  planId: string; // the commercial plan this SLA is tied to
  supportHours: "24x7" | "8x5" | "CUSTOM";
  responseTargetMinutes: {
    LOW: number;
    NORMAL: number;
    HIGH: number;
    URGENT: number;
  };
  dedicatedSupport: boolean;
}

export interface IncidentCommunication {
  incidentId: string;
  title: string;
  severity: "MINOR" | "MAJOR" | "CRITICAL";
  status: "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
  affectedServices: string[];
  updates: {
    timestamp: Date;
    message: string;
  }[];
  startedAt: Date;
  resolvedAt?: Date;
}
