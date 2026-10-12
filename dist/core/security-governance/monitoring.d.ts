import type { AuditLog } from "../audit/audit-log.js";
import type { Repository } from "../../contracts/persistence.js";
import { type AlertSeverity, type SecurityDashboard, type TrustScore } from "../../contracts/security-governance.js";
import type { ProjectFileSource } from "../knowledge-memory/ingestion.js";
import type { SecurityAlertService } from "./alerts.js";
import type { GovernanceApprovals } from "./approvals.js";
import type { EmergencyStop } from "./emergency.js";
import type { GovernanceLedger } from "./ledger.js";
import type { TrustRegistry } from "./trust-registry.js";
export interface SecretContext {
    where: string;
    projectId?: string | undefined;
    agentId?: string | undefined;
    taskId?: string | undefined;
    executionId?: string | undefined;
}
export declare class SecretGuard {
    private readonly alerts;
    private readonly ledger;
    detections: number;
    constructor(alerts: SecurityAlertService, ledger: GovernanceLedger);
    kindsOf(text: string): string[];
    /** Redact, alert and record. The raw secret never leaves this function. */
    screen(text: string, ctx: SecretContext): {
        text: string;
        found: boolean;
        kinds: string[];
    };
}
export declare const SECURITY_CONFIG_PATTERNS: readonly RegExp[];
export interface ConfigBaseline {
    id: string;
    files: Record<string, string>;
    establishedAt: string;
    pending: {
        path: string;
        change: "added" | "modified" | "removed";
        at: string;
        severity: AlertSeverity;
    }[];
    acceptedAt?: string;
    acceptedBy?: string;
}
export declare class ConfigMonitor {
    private readonly alerts;
    private readonly ledger;
    private readonly clock;
    private readonly repo;
    constructor(repo: Repository<ConfigBaseline>, alerts: SecurityAlertService, ledger: GovernanceLedger, clock: () => string);
    get(projectId: string): ConfigBaseline | undefined;
    unacknowledged(projectId?: string): number;
    private snapshot;
    scan(projectId: string, source: ProjectFileSource, by: string): Promise<{
        established: boolean;
        changes: ConfigBaseline["pending"];
        files: number;
    }>;
    /** The user reviewed the changes: the current state becomes the new baseline. */
    accept(projectId: string, source: ProjectFileSource, by: string): Promise<void>;
}
export interface DependencyScan {
    id: string;
    scannedAt: string;
    counts: {
        critical: number;
        high: number;
        moderate: number;
        low: number;
        info: number;
        total: number;
    };
    top: {
        name: string;
        severity: string;
        fixAvailable: boolean;
    }[];
    source: string;
}
/** Parses `npm audit --json` (v7+ shape). Anything unparseable is reported, not guessed. */
export declare function parseNpmAudit(raw: string): {
    ok: true;
    counts: DependencyScan["counts"];
    top: DependencyScan["top"];
} | {
    ok: false;
    error: string;
};
export interface DependencyAuditRunner {
    readonly kind: string;
    audit(projectId: string): Promise<{
        ok: true;
        output: string;
    } | {
        ok: false;
        error: string;
    }>;
}
/** `npm audit --json` in a registered workspace (reads the registry; never installs or upgrades). */
export declare class LocalNpmAuditRunner implements DependencyAuditRunner {
    private readonly cwd;
    private readonly timeoutMs;
    readonly kind = "npm audit";
    constructor(cwd: string, timeoutMs?: number);
    audit(): Promise<{
        ok: true;
        output: string;
    } | {
        ok: false;
        error: string;
    }>;
}
export declare class DependencyScanner {
    private readonly alerts;
    private readonly ledger;
    private readonly clock;
    private readonly repo;
    constructor(repo: Repository<DependencyScan>, alerts: SecurityAlertService, ledger: GovernanceLedger, clock: () => string);
    latest(projectId?: string): DependencyScan | undefined;
    scan(projectId: string, runner: DependencyAuditRunner | undefined, by: string): Promise<{
        ok: true;
        scan: DependencyScan;
    } | {
        ok: false;
        error: string;
    }>;
}
export interface GovernanceFinding {
    findingId: string;
    ruleId: string;
    severity: "low" | "medium" | "high" | "critical";
    subjectId: string;
    detail: string;
}
export declare class GovernanceAuditor {
    private readonly ledger;
    private readonly alerts;
    private readonly approvals;
    private readonly trust;
    private readonly audit;
    private readonly clock;
    private readonly raised;
    constructor(ledger: GovernanceLedger, alerts: SecurityAlertService, approvals: GovernanceApprovals, trust: TrustRegistry, audit: AuditLog | undefined, clock: () => string);
    run(): GovernanceFinding[];
}
export interface DashboardDeps {
    alerts: SecurityAlertService;
    approvals: GovernanceApprovals;
    trust: TrustRegistry;
    ledger: GovernanceLedger;
    emergency: EmergencyStop;
    config: ConfigMonitor;
    deps: DependencyScanner;
    knownAgents: () => string[];
    clock: () => string;
}
export declare function buildDashboard(d: DashboardDeps, projectId?: string): SecurityDashboard;
export declare function computeTrustScore(dash: SecurityDashboard, extra: {
    staleApprovals: number;
    drift7d: number;
    scanned: boolean;
}): TrustScore;
