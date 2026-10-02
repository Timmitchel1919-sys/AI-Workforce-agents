export interface SecurityEvent {
  eventId: string;
  organizationId: string;
  source: "API" | "AUTH" | "WEBHOOK" | "PLATFORM";
  type: "FAILED_LOGIN" | "API_ABUSE" | "DATA_EXFILTRATION_ATTEMPT" | "SUSPICIOUS_IP";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  actor: string; // userId, ipAddress, or apiKeyPrefix
  details: Record<string, any>;
  timestamp: Date;
}

export interface ThreatRule {
  ruleId: string;
  organizationId: string;
  name: string;
  condition: "RATE_LIMIT_EXCEEDED" | "GEO_FENCE_VIOLATION" | "DLP_VIOLATION_SPIKE";
  threshold: number;
  timeWindowSeconds: number;
  action: "ALERT" | "BLOCK_USER" | "REVOKE_KEY" | "IP_BAN";
  status: "ACTIVE" | "INACTIVE";
}

export interface SecurityIncident {
  incidentId: string;
  organizationId: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "INVESTIGATING" | "MITIGATED" | "RESOLVED";
  relatedEvents: string[]; // eventIds
  createdAt: Date;
  resolvedAt?: Date;
}
