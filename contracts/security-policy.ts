import { ValidationError, requireText } from "./index.js";

export const SECURITY_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type SecurityRiskLevel = (typeof SECURITY_RISK_LEVELS)[number];

export interface SecurityPolicyDecision {
  allowed: boolean;
  action: string;
  risk: SecurityRiskLevel;
  requiresApproval: boolean;
  requiresReauthentication: boolean;
  requiresMfa: boolean;
  requiresTwoPersonApproval: boolean;
  reason: string;
  matchedPolicyIds: readonly string[];
  recommendedAlternative?: string;
}

export interface SecurityActionContext {
  action: string;
  actorId: string;
  actorType: "human" | "agent" | "system";
  actorRole?: string;
  agentId?: string;
  projectId?: string;
  environment?: string;
  targetResourceType?: string;
  targetResourceId?: string;
  destructive: boolean;
  irreversible: boolean;
  production: boolean;
  requestedAt: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface SecurityPolicy {
  id: string;
  description: string;
  enabled: boolean;
  /** If provided, matches context.action against these strings/patterns */
  actionPatterns?: readonly string[];
  risk: SecurityRiskLevel;
  productionOnly?: boolean;
  destructiveOnly?: boolean;
  requiresApproval: boolean;
  requiresReauthentication: boolean;
  requiresMfa: boolean;
  requiresTwoPersonApproval: boolean;
  deny: boolean;
  recommendedAlternative?: string;
}

export function validateSecurityActionContext(context: SecurityActionContext): void {
  requireText(context.action, "context.action");
  requireText(context.actorId, "context.actorId");
  if (!["human", "agent", "system"].includes(context.actorType)) {
    throw new ValidationError("context.actorType must be human, agent, or system");
  }
}

