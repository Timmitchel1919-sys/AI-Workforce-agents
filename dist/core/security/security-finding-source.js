export class SecurityFindingStore {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    list(filter = {}) {
        return this.repository.list().filter((f) => {
            if (filter.severity && f.severity !== filter.severity)
                return false;
            if (filter.category && f.category !== filter.category)
                return false;
            if (filter.status && f.status !== filter.status)
                return false;
            if (filter.projectId && f.projectId !== filter.projectId)
                return false;
            return true;
        });
    }
    get(id) {
        return this.repository.findById(id);
    }
    ingest(finding) {
        this.repository.upsert(finding);
    }
    updateStatus(id, status, remediation) {
        const existing = this.repository.findById(id);
        if (!existing)
            return undefined;
        const updated = {
            ...existing,
            status,
            remediation: remediation ?? existing.remediation,
        };
        this.repository.upsert(updated);
        return updated;
    }
    hasUnresolvedCritical() {
        return this.list({ status: "open", severity: "critical" }).length > 0;
    }
}
