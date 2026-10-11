/**
 * Governance, Trust, Security & Policy Intelligence — composition.
 *
 * `SecuritySystem` wires the governor and everything it relies on over the
 * platform repositories, ApprovalSystem and AuditLog. The runtime gate, the
 * orchestrator port, the model gateway and the Layer 3 context source all come
 * from here, so every enforcement point shares ONE policy decision point.
 */
import type {
  ExecutionRun,
  OrchTask,
} from "../../contracts/execution-orchestration.js";
import type { ModelProvider } from "../../contracts/index.js";
import type {
  AgentTrustRecord,
  GovPolicy,
  LedgerEntry,
  ModelTrustRecord,
  SecurityAlert,
  ToolTrustRecord,
  TrustScore,
  SecurityDashboard,
} from "../../contracts/security-governance.js";
import type { ApprovalSystem } from "../approvals/approval-system.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { TaskGovernancePort } from "../execution-orchestration/ports.js";
import type { ActionGate } from "../execution-runtime/tools.js";
import type { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { InMemoryRepository as Mem } from "../persistence/in-memory-repository.js";
import { SecurityAlertService, ThreatDetector } from "./alerts.js";
import { GovernanceApprovals, type ApprovalMeta } from "./approvals.js";
import { GovernanceContextSource } from "./context-source.js";
import { EmergencyStop, type EmergencyRecord } from "./emergency.js";
import {
  PolicyStore,
  SecurityGovernor,
  type AgentDirectory,
} from "./governor.js";
import { GovernanceLedger } from "./ledger.js";
import { GovernedModelProvider, ModelGateway } from "./model-gateway.js";
import {
  ConfigMonitor,
  DependencyScanner,
  GovernanceAuditor,
  SecretGuard,
  buildDashboard,
  computeTrustScore,
  type ConfigBaseline,
  type DependencyScan,
} from "./monitoring.js";
import { TrustRegistry } from "./trust-registry.js";
import type { Repository } from "../../contracts/persistence.js";

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

export interface SecurityRepos {
  policies: Repository<GovPolicy>;
  agentTrust: Repository<AgentTrustRecord>;
  modelTrust: Repository<ModelTrustRecord>;
  toolTrust: Repository<ToolTrustRecord>;
  alerts: Repository<SecurityAlert>;
  ledger: Repository<LedgerEntry>;
  approvalMeta: Repository<ApprovalMeta>;
  emergency: Repository<EmergencyRecord>;
  configBaselines: Repository<ConfigBaseline>;
  dependencyScans: Repository<DependencyScan>;
}

export function inMemorySecurityRepos(): SecurityRepos {
  const r = <T extends { id: string }>() =>
    new Mem<T>() as InMemoryRepository<T>;
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

export interface SecuritySystemOptions {
  repos: SecurityRepos;
  audit: AuditLog;
  approvals: ApprovalSystem;
  agents: AgentDirectory & { list?: () => { id: string }[] };
  isAgentEnabled?: (agentId: string) => boolean;
  clock?: () => string;
  /** Cancel an agent's live executions when it is suspended. */
  onSuspend?: (agentId: string, reason: string) => void;
  annotateSession?: (
    executionId: string,
    patch: {
      reviewRequired?: string[];
      drift?: import("../../contracts/security-governance.js").DriftReport;
    },
  ) => void;
}

export class SecuritySystem {
  readonly ledger: GovernanceLedger;
  readonly trust: TrustRegistry;
  readonly policies: PolicyStore;
  readonly approvals: GovernanceApprovals;
  readonly alerts: SecurityAlertService;
  readonly detector: ThreatDetector;
  readonly emergency: EmergencyStop;
  readonly governor: SecurityGovernor;
  readonly secrets: SecretGuard;
  readonly config: ConfigMonitor;
  readonly deps: DependencyScanner;
  readonly auditor: GovernanceAuditor;
  readonly modelGateway: ModelGateway;
  readonly contextSource: GovernanceContextSource;
  private readonly clock: () => string;
  private readonly knownAgents: () => string[];

  constructor(o: SecuritySystemOptions) {
    this.clock = o.clock ?? (() => new Date().toISOString());
    this.knownAgents = () =>
      o.agents.list ? o.agents.list().map((a) => a.id) : [];
    this.ledger = new GovernanceLedger(o.repos.ledger, o.audit, this.clock);
    this.trust = new TrustRegistry(
      {
        agents: o.repos.agentTrust,
        models: o.repos.modelTrust,
        tools: o.repos.toolTrust,
      },
      this.clock,
      o.isAgentEnabled,
    );
    this.policies = new PolicyStore(o.repos.policies, this.clock);
    this.alerts = new SecurityAlertService(
      o.repos.alerts,
      this.ledger,
      this.clock,
    );
    this.detector = new ThreatDetector(this.alerts);
    this.approvals = new GovernanceApprovals(
      o.approvals,
      o.repos.approvalMeta,
      this.ledger,
      this.clock,
    );
    this.emergency = new EmergencyStop(
      o.repos.emergency,
      this.ledger,
      this.clock,
    );
    this.secrets = new SecretGuard(this.alerts, this.ledger);
    this.config = new ConfigMonitor(
      o.repos.configBaselines,
      this.alerts,
      this.ledger,
      this.clock,
    );
    this.deps = new DependencyScanner(
      o.repos.dependencyScans,
      this.alerts,
      this.ledger,
      this.clock,
    );
    this.auditor = new GovernanceAuditor(
      this.ledger,
      this.alerts,
      this.approvals,
      this.trust,
      o.audit,
      this.clock,
    );
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
  gate(): ActionGate {
    return this.governor.gate();
  }

  /** Wrap a model provider with the gateway (secret/data/emergency checks, output redaction). */
  governedModel(inner: ModelProvider): GovernedModelProvider {
    return new GovernedModelProvider(inner, this.modelGateway, this.secrets);
  }

  /** The Layer 4 orchestrator's governance port. */
  taskGovernance(): TaskGovernancePort {
    return {
      halted: () => this.emergency.halted(),
      assess: async (input: {
        run: ExecutionRun;
        task: OrchTask;
        agentId: string;
        modelId?: string;
      }) => {
        const r = this.governor.assessTask(input);
        return { effect: r.effect, summary: r.summary };
      },
    };
  }

  dashboard(projectId?: string): SecurityDashboard {
    return buildDashboard(
      {
        alerts: this.alerts,
        approvals: this.approvals,
        trust: this.trust,
        ledger: this.ledger,
        emergency: this.emergency,
        config: this.config,
        deps: this.deps,
        knownAgents: this.knownAgents,
        clock: this.clock,
      },
      projectId,
    );
  }

  trustScore(projectId?: string): TrustScore {
    const dash = this.dashboard(projectId);
    const now = Date.parse(this.clock());
    const stale = this.approvals
      .list({ state: ["PENDING"], ...(projectId ? { projectId } : {}) })
      .filter((a) => now - Date.parse(a.requestedAt) > 86_400_000).length;
    const drift = this.ledger
      .all()
      .filter(
        (e) =>
          e.operation === "execution.drift_detected" &&
          now - Date.parse(e.at) <= 7 * 86_400_000 &&
          (!projectId || e.projectId === projectId),
      ).length;
    return computeTrustScore(dash, {
      staleApprovals: stale,
      drift7d: drift,
      scanned: dash.dependencyVulnerabilities !== null,
    });
  }
}
