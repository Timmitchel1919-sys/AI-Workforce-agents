import { InMemoryRepository as Mem } from "../persistence/in-memory-repository.js";
import { SecurityAlertService, ThreatDetector } from "./alerts.js";
import { GovernanceApprovals } from "./approvals.js";
import { GovernanceContextSource } from "./context-source.js";
import { EmergencyStop } from "./emergency.js";
import { PolicyStore, SecurityGovernor, } from "./governor.js";
import { GovernanceLedger } from "./ledger.js";
import { GovernedModelProvider, ModelGateway } from "./model-gateway.js";
import { ConfigMonitor, DependencyScanner, GovernanceAuditor, SecretGuard, buildDashboard, computeTrustScore, } from "./monitoring.js";
import { TrustRegistry } from "./trust-registry.js";
export * from "./resources.js";
export * from "./risk-engine.js";
export * from "./policy-engine.js";
export * from "./permissions.js";
export * from "./trust-registry.js";
export * from "./ledger.js";
export * from "./alerts.js";
export * from "./approvals.js";
export * from "./emergency.js";
export * from "./governor.js";
export * from "./monitoring.js";
export * from "./model-gateway.js";
export * from "./context-source.js";
export function inMemorySecurityRepos() {
    const r = () => new Mem();
    return {
        policies: r(),
        agentTrust: r(),
        modelTrust: r(),
        toolTrust: r(),
        alerts: r(),
        ledger: r(),
        approvalMeta: r(),
        emergency: r(),
        configBaselines: r(),
        dependencyScans: r(),
    };
}
export class SecuritySystem {
    ledger;
    trust;
    policies;
    approvals;
    alerts;
    detector;
    emergency;
    governor;
    secrets;
    config;
    deps;
    auditor;
    modelGateway;
    contextSource;
    clock;
    knownAgents;
    constructor(o) {
        this.clock = o.clock ?? (() => new Date().toISOString());
        this.knownAgents = () => o.agents.list ? o.agents.list().map((a) => a.id) : [];
        this.ledger = new GovernanceLedger(o.repos.ledger, o.audit, this.clock);
        this.trust = new TrustRegistry({
            agents: o.repos.agentTrust,
            models: o.repos.modelTrust,
            tools: o.repos.toolTrust,
        }, this.clock, o.isAgentEnabled);
        this.policies = new PolicyStore(o.repos.policies, this.clock);
        this.alerts = new SecurityAlertService(o.repos.alerts, this.ledger, this.clock);
        this.detector = new ThreatDetector(this.alerts);
        this.approvals = new GovernanceApprovals(o.approvals, o.repos.approvalMeta, this.ledger, this.clock);
        this.emergency = new EmergencyStop(o.repos.emergency, this.ledger, this.clock);
        this.secrets = new SecretGuard(this.alerts, this.ledger);
        this.config = new ConfigMonitor(o.repos.configBaselines, this.alerts, this.ledger, this.clock);
        this.deps = new DependencyScanner(o.repos.dependencyScans, this.alerts, this.ledger, this.clock);
        this.auditor = new GovernanceAuditor(this.ledger, this.alerts, this.approvals, this.trust, o.audit, this.clock);
        this.governor = new SecurityGovernor({
            policies: this.policies,
            trust: this.trust,
            approvals: this.approvals,
            alerts: this.alerts,
            detector: this.detector,
            ledger: this.ledger,
            emergency: this.emergency,
            agents: o.agents,
            clock: this.clock,
            ...(o.onSuspend ? { onSuspend: o.onSuspend } : {}),
            ...(o.annotateSession ? { annotateSession: o.annotateSession } : {}),
        });
        this.modelGateway = new ModelGateway({
            trust: this.trust,
            emergency: this.emergency,
            alerts: this.alerts,
            ledger: this.ledger,
            secrets: this.secrets,
        });
        this.contextSource = new GovernanceContextSource(this.policies);
    }
    /** The policy decision point the Layer 5 runtime asks before every write, delete, command and commit. */
    gate() {
        return this.governor.gate();
    }
    /** Wrap a model provider with the gateway (secret/data/emergency checks, output redaction). */
    governedModel(inner) {
        return new GovernedModelProvider(inner, this.modelGateway, this.secrets);
    }
    /** The Layer 4 orchestrator's governance port. */
    taskGovernance() {
        return {
            halted: () => this.emergency.halted(),
            assess: async (input) => {
                const r = this.governor.assessTask(input);
                return { effect: r.effect, summary: r.summary };
            },
        };
    }
    dashboard(projectId) {
        return buildDashboard({
            alerts: this.alerts,
            approvals: this.approvals,
            trust: this.trust,
            ledger: this.ledger,
            emergency: this.emergency,
            config: this.config,
            deps: this.deps,
            knownAgents: this.knownAgents,
            clock: this.clock,
        }, projectId);
    }
    trustScore(projectId) {
        const dash = this.dashboard(projectId);
        const now = Date.parse(this.clock());
        const stale = this.approvals
            .list({ state: ["PENDING"], ...(projectId ? { projectId } : {}) })
            .filter((a) => now - Date.parse(a.requestedAt) > 86_400_000).length;
        const drift = this.ledger
            .all()
            .filter((e) => e.operation === "execution.drift_detected" &&
            now - Date.parse(e.at) <= 7 * 86_400_000 &&
            (!projectId || e.projectId === projectId)).length;
        return computeTrustScore(dash, {
            staleApprovals: stale,
            drift7d: drift,
            scanned: dash.dependencyVulnerabilities !== null,
        });
    }
}
