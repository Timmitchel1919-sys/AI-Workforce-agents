/**
 * AI Workforce OS — Layer 16: Trust, Governance & Human Oversight Contracts
 *
 * Defines the unified governance framework for AI behavior:
 * - Autonomy policies and risk classification (low, medium, high, critical)
 * - Trust tiers for agents, tools, models, integrations, and workflows
 * - Conceptual data classification (public, internal, sensitive, restricted)
 * - Unified Approval Center with structured explainability (what, why, risks, confidence)
 * - Protection of privileged actions (deletions, secret modifications, infra destruction)
 * - Emergency controls (stop agent, stop workflow, pause automation, lockdown)
 * - Immutable trust events and anomaly detection signals
 */
export const GOVERNANCE_TRUST_LEVELS = [
    "untrusted",
    "limited",
    "standard",
    "trusted",
    "privileged",
];
export const DATA_CLASSIFICATIONS = [
    "public",
    "internal",
    "sensitive",
    "restricted",
];
export const AUTONOMY_POLICY_TIERS = [
    "low_risk", // Automatic execution
    "medium_risk", // Policy-dependent
    "high_risk", // Human approval required
    "critical", // Explicit human approval required (privileged)
];
export const UNIFIED_APPROVAL_STATUSES = [
    "pending",
    "approved",
    "rejected",
    "modified",
    "deferred",
    "cancelled",
];
export const EMERGENCY_CONTROL_ACTIONS = [
    "stop_workflow",
    "stop_agent",
    "pause_automation",
    "disable_tool",
    "revoke_permission",
    "lock_down_high_risk_actions",
];
