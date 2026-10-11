import type {
  Alert, Approval, AgentTrust, AuditRow, Emergency, ModelTrust, Overview, Policy, ProjectSecurity, SecretsResponse,
  SimulationResponse, ToolTrust, TrustResponse,
} from "../types";

const NOW = "2026-05-01T10:00:00.000Z";

export function makeEmergency(over: Partial<Emergency> = {}): Emergency {
  return { id: "global", state: "NORMAL", history: [], ...over };
}

export function makeOverview(over: Partial<Overview> = {}): Overview {
  return {
    banner: null,
    emergency: makeEmergency(),
    dashboard: {
      status: "ATTENTION",
      emergency: "NORMAL",
      openAlerts: 4,
      criticalAlerts: 1,
      blockedActions24h: 7,
      pendingApprovals: 2,
      policyViolations7d: 3,
      suspendedAgents: 1,
      recentEvents: [
        {
          id: "e1", seq: 1, at: NOW, operation: "policy.evaluated", severity: "HIGH", actor: "system", result: "DENY",
          action: "DELETE", resource: "db://prod", detail: {}, prevHash: "0", hash: "h1",
        },
      ],
      dependencyVulnerabilities: null,
      configChangesUnacknowledged: 2,
      generatedAt: NOW,
    },
    trustScore: {
      score: 72,
      label: "Fair",
      factors: [{ factor: "Open critical alerts", count: 1, points: -10 }],
      disclaimer: "This score summarises recorded signals. It is not a guarantee of security.",
    },
    auditorFindings: [{ findingId: "f1", ruleId: "stale_policy", severity: "medium", subjectId: "pol-1", detail: "Policy has not been reviewed." }],
    ledger: { ok: true, entries: 42 },
    capabilities: { policyEngine: true, outboundNetworkDetection: false, dependencyScanning: true, canManage: true, isAdmin: false },
    generatedAt: NOW,
    ...over,
  };
}

export function makePolicy(over: Partial<Policy> = {}): Policy {
  return {
    policyId: "pol-1", name: "Block prod deletes", description: "Deleting production data needs approval.", layer: "PROJECT_SECURITY",
    priority: 50, scope: { projectId: "p1" }, conditions: { actions: ["DELETE"], environments: ["PRODUCTION"], resourceKinds: ["database"] },
    effect: "REQUIRE_APPROVAL", approvalRequirement: null, securityRequirement: null, status: "ENABLED", builtin: false, critical: false,
    version: 2, updatedAt: NOW, updatedBy: "alice", ...over,
  };
}

export const LAYERS = ["SYSTEM_SECURITY", "PROJECT_SECURITY", "PROJECT_ARCHITECTURE", "WORKFLOW", "TASK", "AGENT", "USER_REQUEST"];

export function makeAgent(over: Partial<AgentTrust> = {}): AgentTrust {
  return { id: "at1", agentId: "agent-1", state: "TRUSTED", riskLevel: "LOW", updatedAt: NOW, updatedBy: "alice", history: [], ...over };
}
export function makeModel(over: Partial<ModelTrust> = {}): ModelTrust {
  return {
    id: "m1", provider: "anthropic", model: "claude-x", riskClass: "MEDIUM", approvedTaskTypes: ["code"], maxDataClass: "INTERNAL",
    external: true, dataHandling: "Provider retains nothing.", status: "ENABLED", updatedAt: NOW, updatedBy: "alice", ...over,
  };
}
export function makeTool(over: Partial<ToolTrust> = {}): ToolTrust {
  return {
    id: "t1", toolId: "shell", name: "Shell", capabilities: ["exec"], risk: "HIGH", permissions: ["run"], environments: ["DEVELOPMENT"],
    allowedAgents: ["agent-1"], approval: "HIGH_RISK", securityRequirements: [], status: "ENABLED", updatedAt: NOW, updatedBy: "alice", ...over,
  };
}
export function makeTrust(over: Partial<TrustResponse> = {}): TrustResponse {
  return {
    agents: [makeAgent()], models: [makeModel()], defaultModelPolicy: makeModel({ id: "d", provider: "*", model: "*", dataHandling: "Default handling text." }),
    tools: [makeTool()], states: ["TRUSTED", "LIMITED", "REVIEW_REQUIRED", "SUSPENDED", "DISABLED"], ...over,
  };
}

export function makeApproval(over: Partial<Approval> = {}): Approval {
  return {
    approvalId: "ap1", state: "PENDING", projectId: "p1", action: "DELETE", resource: "db://prod/users", risk: "HIGH",
    reason: "Agent wants to remove stale rows from the users table after the migration finished successfully.",
    expectedImpact: "About 1200 rows removed.", reversibility: "Restorable from last night's backup.", changes: "DELETE FROM users WHERE stale",
    proposedCommand: "psql -c 'DELETE FROM users WHERE stale'", agentId: "agent-1", modelId: "anthropic/claude-x", environment: "PRODUCTION",
    policies: ["pol-1", "pol-9"], requestedBy: "agent-1", requestedAt: NOW, expiresAt: "2026-05-02T10:00:00.000Z", ...over,
  };
}

export function makeAlert(over: Partial<Alert> = {}): Alert {
  return {
    id: "a-id", alertId: "al1", severity: "HIGH", source: "policy-engine", projectId: "p1", agentId: "agent-1", event: "Suspicious deletion",
    description: "An agent attempted to delete production data.", evidence: { path: "db://prod", attempts: 3, blocked: true },
    createdAt: NOW, updatedAt: NOW, status: "OPEN", dedupeKey: "k", occurrences: 3,
    history: [{ status: "OPEN", at: NOW, by: "system" }], ...over,
  };
}

export function makeRow(over: Partial<AuditRow> = {}): AuditRow {
  return {
    seq: 1, at: NOW, who: "agent-1", actor: "agent-1", what: "Deleted table", operation: "action.denied", severity: "HIGH", action: "DELETE",
    resource: "db://prod", risk: "HIGH", policyIds: ["pol-1"], result: "DENY", detail: { reason: "needs approval" }, hash: "abc123", ...over,
  };
}

export function makeSimulation(over: Partial<SimulationResponse["decision"]> = {}): SimulationResponse {
  return {
    executed: false,
    decision: {
      decisionId: "d1", effect: "REQUIRE_APPROVAL",
      risk: { level: "HIGH", score: 70, factors: [{ factor: "production_resource", points: 30, detail: "Touches production" }], blastRadius: "One database", reversible: false },
      resource: { ref: "db://prod", kind: "database", label: "Production DB", dataClass: "CONFIDENTIAL", production: true },
      environment: "PRODUCTION", action: "DELETE",
      policies: [{ policyId: "pol-1", name: "Block prod deletes", layer: "PROJECT_SECURITY", effect: "REQUIRE_APPROVAL", builtin: false }],
      overruled: [{ policyId: "pol-7", name: "Allow cleanup", layer: "TASK", effect: "REQUIRE_REVIEW", builtin: false }],
      obligations: { approval: true, review: false, securityReview: false },
      reasons: ["Production data is protected."], explanation: "Deleting production data requires a human approval first.",
      simulated: true, at: NOW, ...over,
    },
  };
}

export function makeSecrets(over: Partial<SecretsResponse> = {}): SecretsResponse {
  return {
    detectionsThisProcess: 2, detections7d: 5, recent: [],
    protections: ["Secrets are redacted before logging"], configured: [{ name: "OPENAI_API_KEY", configured: true }, { name: "STRIPE_KEY", configured: false }],
    note: "Detection is pattern based and can miss unusual formats.", ...over,
  };
}

export function makeProjectSecurity(over: Partial<ProjectSecurity> = {}): ProjectSecurity {
  return {
    projectId: "p1",
    configBaseline: { establishedAt: NOW, files: 12, pending: [{ path: ".env.example", change: "modified", at: NOW, severity: "high" }], acceptedAt: null },
    dependencyScan: { id: "s1", scannedAt: NOW, counts: { critical: 1, high: 2, moderate: 3, low: 4, info: 0, total: 10 }, top: [{ name: "left-pad", severity: "high", fixAvailable: true }], source: "package-lock.json" },
    openAlerts: 2, drift7d: 1, ...over,
  };
}
