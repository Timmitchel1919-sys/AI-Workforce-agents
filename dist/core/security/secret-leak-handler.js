import { normalizeSecurityEvent } from "./security-event-normalizer.js";
export class SecretLeakHandler {
    findingStore;
    secretRepo;
    securityEvents;
    clock;
    constructor(findingStore, secretRepo, securityEvents, clock = () => new Date().toISOString()) {
        this.findingStore = findingStore;
        this.secretRepo = secretRepo;
        this.securityEvents = securityEvents;
        this.clock = clock;
    }
    async handleLeak(report) {
        const findingId = `leak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const finding = {
            id: findingId,
            source: "gitleaks",
            category: "secret_leak",
            severity: "critical",
            title: `Secret Leak Detected: ${report.ruleId} in ${report.file}`,
            description: report.description,
            file: report.file,
            line: report.line,
            detectedAt: this.clock(),
            status: "open",
            remediation: "Immediately rotate and revoke the compromised credential in its provider vault.",
            metadata: Object.freeze({
                ruleId: report.ruleId,
                secretFingerprint: report.secretHash ?? "redacted",
            }),
        };
        this.findingStore.ingest(finding);
        // If matched to a managed secret reference, flag it for immediate rotation
        if (report.matchedReferenceId) {
            const ref = this.secretRepo.findById(report.matchedReferenceId);
            if (ref && ref.status === "active") {
                this.secretRepo.upsert({
                    ...ref,
                    status: "rotation_required",
                    rotationDueAt: this.clock(),
                    updatedAt: this.clock(),
                });
            }
        }
        if (this.securityEvents) {
            try {
                await this.securityEvents.append(normalizeSecurityEvent({
                    eventId: `sec-leak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    occurredAt: this.clock(),
                    category: "secrets",
                    type: "secret_leak_detected",
                    severity: "critical",
                    outcome: "blocked",
                    actor: { kind: "system" },
                    source: { kind: "secret_scanner", id: "gitleaks" },
                    target: { kind: "repository_file", id: report.file },
                    evidence: Object.freeze({
                        ruleId: report.ruleId,
                        file: report.file,
                        line: report.line,
                        matchedReferenceId: report.matchedReferenceId,
                    }),
                }));
            }
            catch {
                // Non-blocking for audit event failures
            }
        }
        return finding;
    }
}
