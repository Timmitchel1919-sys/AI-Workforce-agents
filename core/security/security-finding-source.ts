import type {
  Repository,
  SecurityFinding,
  SecurityFindingCategory,
  SecurityFindingSeverity,
  SecurityFindingStatus,
} from "../../contracts/index.js";

export interface FindingFilter {
  severity?: SecurityFindingSeverity;
  category?: SecurityFindingCategory;
  status?: SecurityFindingStatus;
  projectId?: string;
}

export class SecurityFindingStore {
  constructor(private readonly repository: Repository<SecurityFinding>) {}

  list(filter: FindingFilter = {}): SecurityFinding[] {
    return this.repository.list().filter((f) => {
      if (filter.severity && f.severity !== filter.severity) return false;
      if (filter.category && f.category !== filter.category) return false;
      if (filter.status && f.status !== filter.status) return false;
      if (filter.projectId && f.projectId !== filter.projectId) return false;
      return true;
    });
  }

  get(id: string): SecurityFinding | undefined {
    return this.repository.findById(id);
  }

  ingest(finding: SecurityFinding): void {
    this.repository.upsert(finding);
  }

  updateStatus(
    id: string,
    status: SecurityFindingStatus,
    remediation?: string,
  ): SecurityFinding | undefined {
    const existing = this.repository.findById(id);
    if (!existing) return undefined;
    const updated: SecurityFinding = {
      ...existing,
      status,
      remediation: remediation ?? existing.remediation,
    };
    this.repository.upsert(updated);
    return updated;
  }

  hasUnresolvedCritical(): boolean {
    return this.list({ status: "open", severity: "critical" }).length > 0;
  }
}
