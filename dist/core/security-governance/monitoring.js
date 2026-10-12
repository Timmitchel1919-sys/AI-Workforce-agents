/**
 * Monitoring: secret guard, security-configuration baseline, dependency
 * vulnerability scan, the independent governance auditor, the operational
 * trust score and the security dashboard. Everything here is derived from
 * recorded signals — nothing is declared, so nothing can claim more safety than
 * was measured.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { containsSecret, maskSecrets, } from "../prompt-intelligence/secret-scan.js";
const DAY = 86_400_000;
/* ------------------------------------------------------------------ */
/* Secret guard                                                        */
/* ------------------------------------------------------------------ */
const SECRET_KINDS = [
    ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["github token", /\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
    ["aws access key", /\bAKIA[0-9A-Z]{16}\b/],
    ["google api key", /AIza[0-9A-Za-z_-]{30,}/],
    ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
    ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
    [
        "password / key assignment",
        /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"',;]{6,}/i,
    ],
    [
        "credential in url",
        /[a-z][a-z0-9+.-]{1,19}:\/\/[^\s:@/]{1,100}:[^\s@/]{3,100}@/i,
    ],
];
export class SecretGuard {
    alerts;
    ledger;
    detections = 0;
    constructor(alerts, ledger) {
        this.alerts = alerts;
        this.ledger = ledger;
    }
    kindsOf(text) {
        const found = SECRET_KINDS.filter(([, re]) => re.test(text)).map(([k]) => k);
        return found.length === 0 && containsSecret(text) ? ["credential"] : found;
    }
    /** Redact, alert and record. The raw secret never leaves this function. */
    screen(text, ctx) {
        if (!text || !containsSecret(text))
            return { text, found: false, kinds: [] };
        const kinds = this.kindsOf(text);
        this.detections++;
        const severity = kinds.includes("private key")
            ? "CRITICAL"
            : "HIGH";
        this.alerts.raise({
            severity,
            source: "SECRET_GUARD",
            event: "secret_detected",
            description: `A ${kinds.join(", ")} appeared in ${ctx.where}; it was redacted and not stored.`,
            projectId: ctx.projectId,
            agentId: ctx.agentId,
            taskId: ctx.taskId,
            executionId: ctx.executionId,
            evidence: { where: ctx.where, kinds: kinds.join(", ") },
            dedupeKey: `secret:${ctx.where}:${ctx.agentId ?? ""}:${ctx.executionId ?? ""}`,
        });
        this.ledger.record("secret.detected", {
            actor: ctx.agentId ?? "system",
            severity,
            projectId: ctx.projectId,
            agentId: ctx.agentId,
            taskId: ctx.taskId,
            executionId: ctx.executionId,
            result: "REDACTED",
            detail: { where: ctx.where, kinds: kinds.join(", ") },
        });
        return { text: maskSecrets(text), found: true, kinds };
    }
}
/* ------------------------------------------------------------------ */
/* Security configuration baseline                                     */
/* ------------------------------------------------------------------ */
export const SECURITY_CONFIG_PATTERNS = [
    /(^|\/)[\w.-]*\.rules$/,
    /(^|\/)database\.rules\.json$/,
    /(^|\/)firebase\.json$/,
    /(^|\/)\.firebaserc$/,
    /(^|\/)firestore\.indexes\.json$/,
    /(^|\/)\.github\/workflows\/[^/]+$/,
    /(^|\/)(vercel\.json|dockerfile|cloudbuild\.yaml|\.gitlab-ci\.yml)$/i,
    /(^|\/)\.env\.example$/,
    /(^|\/)package\.json$/,
    /(^|\/)(firebase(config)?|auth\.config)\.(ts|js|json)$/i,
];
export class ConfigMonitor {
    alerts;
    ledger;
    clock;
    repo;
    constructor(repo, alerts, ledger, clock) {
        this.alerts = alerts;
        this.ledger = ledger;
        this.clock = clock;
        this.repo = new SyncCache(repo);
    }
    get(projectId) {
        return this.repo.findById(projectId);
    }
    unacknowledged(projectId) {
        return this.repo
            .list()
            .filter((b) => !projectId || b.id === projectId)
            .reduce((n, b) => n + b.pending.length, 0);
    }
    async snapshot(source) {
        const listing = await source.list();
        const out = {};
        for (const path of listing.paths.map((p) => p.replace(/\\/g, "/"))) {
            if (!SECURITY_CONFIG_PATTERNS.some((re) => re.test(path)))
                continue;
            const text = await source.read(path);
            if (text !== undefined)
                out[path] = createHash("sha256")
                    .update(text)
                    .digest("hex")
                    .slice(0, 24);
        }
        return out;
    }
    async scan(projectId, source, by) {
        const now = this.clock();
        const current = await this.snapshot(source);
        const base = this.repo.findById(projectId);
        if (!base) {
            this.repo.upsert({
                id: projectId,
                files: current,
                establishedAt: now,
                pending: [],
            });
            this.ledger.record("security.config_baseline", {
                actor: by,
                projectId,
                result: "ESTABLISHED",
                detail: { files: Object.keys(current).length },
            });
            return {
                established: true,
                changes: [],
                files: Object.keys(current).length,
            };
        }
        const changes = [];
        const severityOf = (p) => /\.rules$|rules\.json$/.test(p)
            ? "HIGH"
            : /auth|firebaserc|workflows|dockerfile|cloudbuild|gitlab/i.test(p)
                ? "HIGH"
                : "MEDIUM";
        for (const [path, hash] of Object.entries(current)) {
            if (base.files[path] === undefined)
                changes.push({
                    path,
                    change: "added",
                    at: now,
                    severity: severityOf(path),
                });
            else if (base.files[path] !== hash)
                changes.push({
                    path,
                    change: "modified",
                    at: now,
                    severity: severityOf(path),
                });
        }
        for (const path of Object.keys(base.files))
            if (current[path] === undefined)
                changes.push({
                    path,
                    change: "removed",
                    at: now,
                    severity: severityOf(path),
                });
        const known = new Set(base.pending.map((p) => `${p.path}:${p.change}`));
        const fresh = changes.filter((c) => !known.has(`${c.path}:${c.change}`));
        this.repo.upsert({ ...base, pending: changes });
        for (const c of fresh) {
            this.alerts.raise({
                severity: c.severity,
                source: "CONFIG_MONITOR",
                event: "security_config_changed",
                description: `Security-relevant configuration ${c.change}: ${c.path}`,
                projectId,
                evidence: { path: c.path, change: c.change },
                dedupeKey: `config:${projectId}:${c.path}`,
            });
            this.ledger.record("security.config_changed", {
                actor: by,
                severity: c.severity,
                projectId,
                resource: c.path,
                result: c.change.toUpperCase(),
            });
        }
        return { established: false, changes, files: Object.keys(current).length };
    }
    /** The user reviewed the changes: the current state becomes the new baseline. */
    async accept(projectId, source, by) {
        const base = this.repo.findById(projectId);
        if (!base)
            return;
        const current = await this.snapshot(source);
        this.repo.upsert({
            ...base,
            files: current,
            pending: [],
            acceptedAt: this.clock(),
            acceptedBy: by,
        });
        this.ledger.record("security.config_accepted", {
            actor: by,
            severity: "HIGH",
            projectId,
            result: "ACCEPTED",
        });
    }
}
/** Parses `npm audit --json` (v7+ shape). Anything unparseable is reported, not guessed. */
export function parseNpmAudit(raw) {
    let data;
    try {
        data = JSON.parse(raw);
    }
    catch {
        return { ok: false, error: "the audit output was not valid JSON" };
    }
    const obj = data;
    if (obj?.error)
        return {
            ok: false,
            error: String(obj.error.summary ?? "audit failed").slice(0, 200),
        };
    const m = obj?.metadata?.vulnerabilities;
    const vulns = obj?.vulnerabilities;
    if (!m && !vulns)
        return { ok: false, error: "the audit output had no vulnerability data" };
    const counts = {
        critical: m?.["critical"] ?? 0,
        high: m?.["high"] ?? 0,
        moderate: m?.["moderate"] ?? 0,
        low: m?.["low"] ?? 0,
        info: m?.["info"] ?? 0,
        total: m?.["total"] ?? 0,
    };
    if (!m && vulns) {
        for (const v of Object.values(vulns)) {
            const k = (v.severity ?? "info");
            if (k in counts && k !== "total")
                counts[k]++;
            counts.total++;
        }
    }
    const order = ["critical", "high", "moderate", "low", "info"];
    const top = Object.entries(vulns ?? {})
        .map(([name, v]) => ({
        name,
        severity: v.severity ?? "info",
        fixAvailable: Boolean(v.fixAvailable),
    }))
        .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
        .slice(0, 15);
    return { ok: true, counts, top };
}
/** `npm audit --json` in a registered workspace (reads the registry; never installs or upgrades). */
export class LocalNpmAuditRunner {
    cwd;
    timeoutMs;
    kind = "npm audit";
    constructor(cwd, timeoutMs = 60_000) {
        this.cwd = cwd;
        this.timeoutMs = timeoutMs;
    }
    audit() {
        return new Promise((resolve) => {
            const win = process.platform === "win32";
            const child = spawn(win ? "cmd.exe" : "npm", win ? ["/d", "/s", "/c", "npm audit --json"] : ["audit", "--json"], {
                cwd: this.cwd,
                shell: false,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
            });
            let out = "";
            child.stdout?.on("data", (b) => {
                if (out.length < 2_000_000)
                    out += b.toString("utf8");
            });
            const timer = setTimeout(() => child.kill("SIGKILL"), this.timeoutMs);
            child.on("error", () => {
                clearTimeout(timer);
                resolve({ ok: false, error: "npm is not available on this host" });
            });
            // npm audit exits non-zero when it FINDS vulnerabilities; the JSON is still the result.
            child.on("close", () => {
                clearTimeout(timer);
                resolve(out.trim()
                    ? { ok: true, output: out }
                    : { ok: false, error: "npm audit produced no output (offline?)" });
            });
        });
    }
}
export class DependencyScanner {
    alerts;
    ledger;
    clock;
    repo;
    constructor(repo, alerts, ledger, clock) {
        this.alerts = alerts;
        this.ledger = ledger;
        this.clock = clock;
        this.repo = new SyncCache(repo);
    }
    latest(projectId) {
        const all = this.repo
            .list()
            .filter((s) => !projectId || s.id === projectId);
        return all.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))[0];
    }
    async scan(projectId, runner, by) {
        if (!runner)
            return {
                ok: false,
                error: "dependency scanning is not available: no workspace is registered for this project",
            };
        const result = await runner.audit(projectId);
        if (!result.ok)
            return result;
        const parsed = parseNpmAudit(result.output);
        if (!parsed.ok)
            return parsed;
        const scan = {
            id: projectId,
            scannedAt: this.clock(),
            counts: parsed.counts,
            top: parsed.top,
            source: runner.kind,
        };
        this.repo.upsert(scan);
        this.ledger.record("security.dependency_scan", {
            actor: by,
            projectId,
            result: "SCANNED",
            detail: { ...parsed.counts },
        });
        if (parsed.counts.critical > 0 || parsed.counts.high > 0) {
            this.alerts.raise({
                severity: parsed.counts.critical > 0 ? "CRITICAL" : "HIGH",
                source: "DEPENDENCY",
                event: "dependency_vulnerabilities",
                description: `${parsed.counts.critical} critical and ${parsed.counts.high} high dependency vulnerabilities (${runner.kind}). Nothing was upgraded automatically.`,
                projectId,
                evidence: {
                    critical: parsed.counts.critical,
                    high: parsed.counts.high,
                    moderate: parsed.counts.moderate,
                },
                dedupeKey: `deps:${projectId}`,
            });
        }
        return { ok: true, scan };
    }
}
export class GovernanceAuditor {
    ledger;
    alerts;
    approvals;
    trust;
    audit;
    clock;
    raised = new Set();
    constructor(ledger, alerts, approvals, trust, audit, clock) {
        this.ledger = ledger;
        this.alerts = alerts;
        this.approvals = approvals;
        this.trust = trust;
        this.audit = audit;
        this.clock = clock;
    }
    run() {
        const now = Date.parse(this.clock());
        const entries = this.ledger.all();
        const out = [];
        const add = (ruleId, severity, subjectId, detail) => out.push({
            findingId: `${ruleId}:${subjectId}`,
            ruleId,
            severity,
            subjectId,
            detail,
        });
        for (const e of entries) {
            if (e.operation === "policy.allowed" &&
                (e.risk === "HIGH" || e.risk === "CRITICAL") &&
                !e.detail["approval"])
                add("governance.high_risk_auto_allowed", "high", e.id, `A ${e.risk} action (${e.action} ${e.resource}) was allowed without an approval record.`);
            if (e.operation === "approval.approved" &&
                e.risk === "CRITICAL" &&
                !e.detail["note"])
                add("governance.critical_approved_without_reason", "medium", e.id, `A CRITICAL action (${e.action} ${e.resource}) was approved without a written reason.`);
        }
        const recentDenied = entries.filter((e) => e.operation === "policy.denied" && now - Date.parse(e.at) <= 3_600_000).length;
        if (recentDenied >= 10)
            add("governance.denial_spike", "medium", "last-hour", `${recentDenied} policy denials in the last hour.`);
        const secrets = entries.filter((e) => e.operation === "secret.detected" && now - Date.parse(e.at) <= DAY).length;
        if (secrets >= 3)
            add("governance.secret_detections", "high", "last-24h", `${secrets} secret detections in 24 hours.`);
        const byAgent = new Map();
        for (const a of this.alerts.list({ openOnly: true }))
            if (a.agentId && a.event === "policy_violation")
                byAgent.set(a.agentId, (byAgent.get(a.agentId) ?? 0) + a.occurrences);
        for (const [agent, n] of byAgent)
            if (n >= 3 && this.trust.agentState(agent) === "TRUSTED")
                add("governance.agent_repeat_violations", "high", agent, `${agent} caused ${n} policy violations and is still fully trusted.`);
        for (const v of this.approvals.list({ state: ["PENDING"] })) {
            // Age comes from the governance ledger (the platform approval record uses wall-clock time).
            const asked = entries.find((e) => e.operation === "approval.requested" &&
                e.detail["approvalId"] === v.approvalId);
            if (asked && now - Date.parse(asked.at) > 12 * 3_600_000)
                add("governance.stale_approval", "low", v.approvalId, `Approval ${v.approvalId} has waited more than 12 hours.`);
        }
        const suspensions = entries.filter((e) => e.operation === "agent.suspended");
        for (const s of suspensions) {
            const lifted = entries.find((e) => e.operation === "agent.enabled" &&
                e.agentId === s.agentId &&
                e.seq > s.seq &&
                Date.parse(e.at) - Date.parse(s.at) < 3_600_000);
            if (lifted)
                add("governance.rapid_reinstatement", "medium", `${s.agentId}`, `${s.agentId} was reinstated less than an hour after being suspended.`);
        }
        const integrity = this.ledger.verify();
        if (!integrity.ok)
            add("governance.ledger_integrity", "critical", `seq-${integrity.brokenAt}`, `The governance ledger failed verification at entry ${integrity.brokenAt}.`);
        for (const f of out) {
            if (this.raised.has(f.findingId))
                continue;
            this.raised.add(f.findingId);
            this.audit?.record("audit_finding_raised", {
                data: {
                    ruleId: f.ruleId,
                    severity: f.severity,
                    subjectType: "governance",
                    subjectId: f.subjectId,
                },
            });
            if (f.severity === "critical")
                this.alerts.raise({
                    severity: "CRITICAL",
                    source: "AUDITOR",
                    event: f.ruleId,
                    description: f.detail,
                    evidence: { subject: f.subjectId },
                    dedupeKey: `auditor:${f.findingId}`,
                });
        }
        return out;
    }
}
export function buildDashboard(d, projectId) {
    const now = Date.parse(d.clock());
    const open = d.alerts.list({
        openOnly: true,
        ...(projectId ? { projectId } : {}),
    });
    const entries = d.ledger.all();
    const week = entries.filter((e) => now - Date.parse(e.at) <= 7 * DAY &&
        (!projectId || e.projectId === projectId));
    const scan = d.deps.latest(projectId);
    const suspended = d.trust
        .listAgents(d.knownAgents())
        .filter((a) => a.state === "SUSPENDED" || a.state === "DISABLED").length;
    const emergency = d.emergency.state;
    const critical = open.filter((a) => a.severity === "CRITICAL").length;
    const status = emergency !== "NORMAL"
        ? "HALTED"
        : critical > 0
            ? "DEGRADED"
            : open.some((a) => a.severity === "HIGH") || suspended > 0
                ? "ATTENTION"
                : "NOMINAL";
    return {
        status,
        emergency,
        openAlerts: open.length,
        criticalAlerts: critical,
        blockedActions24h: entries.filter((e) => e.operation === "execution.blocked" &&
            now - Date.parse(e.at) <= DAY &&
            (!projectId || e.projectId === projectId)).length,
        pendingApprovals: d.approvals.list({
            state: ["PENDING"],
            ...(projectId ? { projectId } : {}),
        }).length,
        policyViolations7d: week.filter((e) => e.operation === "policy.denied")
            .length,
        suspendedAgents: suspended,
        recentEvents: entries
            .slice(-20)
            .reverse()
            .filter((e) => !projectId || e.projectId === projectId || e.projectId === undefined),
        dependencyVulnerabilities: scan
            ? {
                scannedAt: scan.scannedAt,
                critical: scan.counts.critical,
                high: scan.counts.high,
                moderate: scan.counts.moderate,
                low: scan.counts.low,
            }
            : null,
        configChangesUnacknowledged: d.config.unacknowledged(projectId),
        generatedAt: d.clock(),
    };
}
export function computeTrustScore(dash, extra) {
    const factors = [];
    const take = (factor, count, each, cap) => {
        if (count > 0)
            factors.push({ factor, count, points: -Math.min(cap, count * each) });
    };
    const open = dash.openAlerts;
    take("Open CRITICAL alerts", dash.criticalAlerts, 20, 40);
    take("Other open alerts", Math.max(0, open - dash.criticalAlerts), 3, 18);
    take("Policy violations (7 days)", dash.policyViolations7d, 1, 10);
    take("Suspended or disabled agents", dash.suspendedAgents, 3, 9);
    take("Approvals waiting more than 24h", extra.staleApprovals, 2, 6);
    take("Execution drift events (7 days)", extra.drift7d, 2, 8);
    take("Unacknowledged security-config changes", dash.configChangesUnacknowledged, 3, 9);
    if (dash.dependencyVulnerabilities) {
        take("Critical dependency vulnerabilities", dash.dependencyVulnerabilities.critical, 5, 15);
        take("High dependency vulnerabilities", dash.dependencyVulnerabilities.high, 2, 8);
    }
    if (dash.emergency !== "NORMAL")
        factors.push({
            factor: `Emergency stop (${dash.emergency})`,
            count: 1,
            points: -30,
        });
    const score = Math.max(0, 100 + factors.reduce((n, f) => n + f.points, 0));
    return {
        score,
        label: score >= 90
            ? "No significant open signals"
            : score >= 70
                ? "Some open signals"
                : score >= 40
                    ? "Needs attention"
                    : "Degraded",
        factors,
        disclaimer: `An operational indicator of measured signals only${extra.scanned ? "" : " (dependency vulnerabilities have not been scanned)"} — not a guarantee of security.`,
    };
}
