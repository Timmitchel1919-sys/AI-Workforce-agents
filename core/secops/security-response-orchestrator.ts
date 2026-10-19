import type { NormalizedSecuritySignal, SecurityFinding } from "../../contracts/secops.js";
import type { OperatorPrincipal } from "../../contracts/index.js";

export interface SecurityAgentIdentity { readonly id: string; readonly capabilities: readonly string[]; }
export interface SecurityResponseAction { findingId: string; action: "ALERT" | "REQUEST_CONTAINMENT"; reason: string; }
export interface SecurityResponseGate { requestContainment(principal: OperatorPrincipal, findingId: string, reason: string): string; }

/** Advisory-first threat response. It cannot mutate resources or self-grant capabilities. */
export class SecurityResponseOrchestrator {
  constructor(private readonly identity: SecurityAgentIdentity, private readonly gate: SecurityResponseGate) {
    if (!identity.capabilities.includes("security.read") || identity.capabilities.some((c) => c === "resource.write" || c === "admin")) throw new Error("security agent identity is too privileged");
  }
  evaluate(signal: NormalizedSecuritySignal, threshold = 80): SecurityFinding {
    const score = Math.min(100, (signal.attributes.rate ?? 0) >= 10 ? 90 : signal.kind.includes("suspicious") ? 70 : 20);
    return { findingId: `finding_${signal.signalId}`, organizationId: signal.organizationId, signalIds: [signal.signalId], ruleId: `deterministic:${signal.kind}`, riskScore: score, rationale: [`signal kind ${signal.kind}`, `actor ${signal.actor}`, `risk score ${score}`], status: "OPEN", createdAt: signal.observedAt };
  }
  respond(principal: OperatorPrincipal, finding: SecurityFinding, threshold = 80): SecurityResponseAction {
    if (finding.riskScore < threshold) return { findingId: finding.findingId, action: "ALERT", reason: "below containment threshold" };
    this.gate.requestContainment(principal, finding.findingId, finding.rationale.join("; "));
    return { findingId: finding.findingId, action: "REQUEST_CONTAINMENT", reason: "high risk requires governed approval" };
  }
}
