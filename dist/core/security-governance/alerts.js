/**
 * Security alerts and rule-based threat detection.
 *
 * Alerts are masked, bounded, de-duplicated while open, and follow a strict
 * lifecycle (OPEN → ACKNOWLEDGED → INVESTIGATING → RESOLVED | FALSE_POSITIVE).
 * HIGH/CRITICAL alerts can only be closed by an administrator with a note and
 * are never deleted. Detection is deterministic (sliding windows over decision
 * events) — it watches agent behaviour against policy, not people.
 */
import { randomBytes } from "node:crypto";
import { ALERT_SEVERITIES, } from "../../contracts/security-governance.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
export class AlertError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "AlertError";
    }
}
export const severityRank = (s) => ALERT_SEVERITIES.indexOf(s);
const OPEN_STATES = [
    "OPEN",
    "ACKNOWLEDGED",
    "INVESTIGATING",
];
const NEXT = {
    OPEN: ["ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"],
    ACKNOWLEDGED: ["INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"],
    INVESTIGATING: ["RESOLVED", "FALSE_POSITIVE"],
    RESOLVED: [],
    FALSE_POSITIVE: [],
};
export class SecurityAlertService {
    ledger;
    clock;
    onRaised;
    repo;
    constructor(repo, ledger, clock, onRaised) {
        this.ledger = ledger;
        this.clock = clock;
        this.onRaised = onRaised;
        this.repo = new SyncCache(repo);
    }
    evidence(e) {
        const out = {};
        let n = 0;
        for (const [k, v] of Object.entries(e ?? {})) {
            if (n++ >= 16)
                break;
            out[k.slice(0, 40)] =
                typeof v === "number" || typeof v === "boolean"
                    ? v
                    : maskSecrets(String(v)).slice(0, 240);
        }
        return out;
    }
    raise(input) {
        const dedupeKey = input.dedupeKey ??
            `${input.source}:${input.event}:${input.agentId ?? ""}:${input.projectId ?? ""}`;
        const existing = this.repo
            .list()
            .find((a) => a.dedupeKey === dedupeKey && OPEN_STATES.includes(a.status));
        const now = this.clock();
        if (existing) {
            const next = {
                ...existing,
                occurrences: existing.occurrences + 1,
                updatedAt: now,
                severity: severityRank(input.severity) > severityRank(existing.severity)
                    ? input.severity
                    : existing.severity,
                evidence: { ...existing.evidence, ...this.evidence(input.evidence) },
            };
            this.repo.upsert(next);
            return next;
        }
        const alertId = `alert-${randomBytes(5).toString("hex")}`;
        const alert = {
            id: alertId,
            alertId,
            severity: input.severity,
            source: input.source,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            ...(input.executionId ? { executionId: input.executionId } : {}),
            ...(input.taskId ? { taskId: input.taskId } : {}),
            ...(input.agentId ? { agentId: input.agentId } : {}),
            event: input.event,
            description: maskSecrets(input.description).slice(0, 400),
            evidence: this.evidence(input.evidence),
            createdAt: now,
            updatedAt: now,
            status: "OPEN",
            dedupeKey,
            occurrences: 1,
            history: [{ status: "OPEN", at: now, by: "system" }],
        };
        this.repo.upsert(alert);
        this.ledger.record("security.alert", {
            actor: "security",
            severity: alert.severity,
            projectId: alert.projectId,
            agentId: alert.agentId,
            taskId: alert.taskId,
            executionId: alert.executionId,
            result: alert.event,
            detail: { alertId, source: alert.source, description: alert.description },
        });
        this.onRaised?.(alert);
        return alert;
    }
    get(alertId) {
        return this.repo.findById(alertId);
    }
    list(filter = {}) {
        return this.repo
            .list()
            .filter((a) => !filter.openOnly || OPEN_STATES.includes(a.status))
            .filter((a) => !filter.status || filter.status.includes(a.status))
            .filter((a) => !filter.severity || filter.severity.includes(a.severity))
            .filter((a) => !filter.projectId || a.projectId === filter.projectId)
            .filter((a) => !filter.agentId || a.agentId === filter.agentId)
            .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) ||
            b.updatedAt.localeCompare(a.updatedAt));
    }
    transition(alertId, to, by, opts) {
        const a = this.get(alertId);
        if (!a)
            throw new AlertError("not_found", "alert not found");
        if (!NEXT[a.status].includes(to))
            throw new AlertError("invalid_state", `an alert that is ${a.status} cannot become ${to}`);
        const closing = to === "RESOLVED" || to === "FALSE_POSITIVE";
        if (closing && !opts.note?.trim())
            throw new AlertError("invalid_request", "closing an alert needs a note");
        if (closing &&
            severityRank(a.severity) >= severityRank("HIGH") &&
            !opts.admin)
            throw new AlertError("forbidden", "only an administrator can close a HIGH or CRITICAL alert");
        const now = this.clock();
        const next = {
            ...a,
            status: to,
            updatedAt: now,
            history: [
                ...a.history,
                {
                    status: to,
                    at: now,
                    by,
                    ...(opts.note ? { note: maskSecrets(opts.note).slice(0, 300) } : {}),
                },
            ],
        };
        this.repo.upsert(next);
        this.ledger.record("security.alert_updated", {
            actor: by,
            severity: a.severity,
            projectId: a.projectId,
            agentId: a.agentId,
            result: to,
            detail: { alertId },
        });
        return next;
    }
}
export class ThreatDetector {
    alerts;
    windowMs;
    signals = [];
    constructor(alerts, windowMs = 10 * 60_000) {
        this.alerts = alerts;
        this.windowMs = windowMs;
    }
    ingest(signal) {
        this.signals.push(signal);
        const cutoff = signal.at - this.windowMs;
        while (this.signals.length > 0 && this.signals[0].at < cutoff)
            this.signals.shift();
        if (this.signals.length > 5000)
            this.signals.splice(0, this.signals.length - 5000);
        const mine = this.signals.filter((s) => signal.agentId ? s.agentId === signal.agentId : false);
        const count = (k) => mine.filter((s) => s.kind === k).length;
        const base = {
            agentId: signal.agentId,
            projectId: signal.projectId,
            taskId: signal.taskId,
            executionId: signal.executionId,
        };
        const out = {};
        const denied = count("DENIED") +
            count("SCOPE_VIOLATION") +
            count("SECRET_ACCESS") +
            count("PRIVILEGE_ESCALATION");
        if (signal.agentId && denied >= 3) {
            const severity = denied >= 8 ? "CRITICAL" : denied >= 5 ? "HIGH" : "MEDIUM";
            this.alerts.raise({
                ...base,
                severity,
                source: "THREAT_DETECTOR",
                event: "repeated_authorization_failures",
                description: `${signal.agentId} was refused ${denied} times in ${Math.round(this.windowMs / 60000)} minutes.`,
                evidence: { refusals: denied },
                dedupeKey: `threat:repeated_denials:${signal.agentId}`,
            });
            if (denied >= 8)
                out.suspend = {
                    agentId: signal.agentId,
                    reason: `${denied} refused actions in ${Math.round(this.windowMs / 60000)} minutes`,
                };
        }
        if (signal.kind === "SECRET_ACCESS" && signal.agentId) {
            this.alerts.raise({
                ...base,
                severity: "HIGH",
                source: "THREAT_DETECTOR",
                event: "secret_access_attempt",
                description: `${signal.agentId} tried to reach a secret or credential file.`,
                evidence: { resource: signal.resource ?? "" },
                dedupeKey: `threat:secret_access:${signal.agentId}`,
            });
            out.reviewRequired = {
                agentId: signal.agentId,
                reason: "attempted to access secrets",
            };
        }
        if (signal.kind === "PRIVILEGE_ESCALATION" && signal.agentId) {
            this.alerts.raise({
                ...base,
                severity: "HIGH",
                source: "THREAT_DETECTOR",
                event: "privilege_escalation_attempt",
                description: `${signal.agentId} tried to change policy, trust or permissions.`,
                evidence: { resource: signal.resource ?? "" },
                dedupeKey: `threat:privilege_escalation:${signal.agentId}`,
            });
            out.reviewRequired = {
                agentId: signal.agentId,
                reason: "attempted privilege escalation",
            };
        }
        if (signal.agentId && count("DESTRUCTIVE_REQUEST") >= 3) {
            this.alerts.raise({
                ...base,
                severity: "MEDIUM",
                source: "THREAT_DETECTOR",
                event: "repeated_destructive_requests",
                description: `${signal.agentId} asked for ${count("DESTRUCTIVE_REQUEST")} destructive actions in a short time.`,
                evidence: { requests: count("DESTRUCTIVE_REQUEST") },
                dedupeKey: `threat:destructive:${signal.agentId}`,
            });
        }
        if (signal.agentId && count("SENSITIVE_READ") >= 15) {
            this.alerts.raise({
                ...base,
                severity: "MEDIUM",
                source: "THREAT_DETECTOR",
                event: "abnormal_file_access",
                description: `${signal.agentId} read ${count("SENSITIVE_READ")} sensitive files in a short time.`,
                evidence: { reads: count("SENSITIVE_READ") },
                dedupeKey: `threat:abnormal_access:${signal.agentId}`,
            });
        }
        if (signal.agentId && count("BLOCKED_COMMAND") >= 2) {
            this.alerts.raise({
                ...base,
                severity: "MEDIUM",
                source: "THREAT_DETECTOR",
                event: "suspicious_commands",
                description: `${signal.agentId} attempted ${count("BLOCKED_COMMAND")} blocked commands.`,
                evidence: { commands: count("BLOCKED_COMMAND") },
                dedupeKey: `threat:commands:${signal.agentId}`,
            });
        }
        return out;
    }
}
