import type { Repository, SecurityFinding, SecurityFindingCategory, SecurityFindingSeverity, SecurityFindingStatus } from "../../contracts/index.js";
export interface FindingFilter {
    severity?: SecurityFindingSeverity;
    category?: SecurityFindingCategory;
    status?: SecurityFindingStatus;
    projectId?: string;
}
export declare class SecurityFindingStore {
    private readonly repository;
    constructor(repository: Repository<SecurityFinding>);
    list(filter?: FindingFilter): SecurityFinding[];
    get(id: string): SecurityFinding | undefined;
    ingest(finding: SecurityFinding): void;
    updateStatus(id: string, status: SecurityFindingStatus, remediation?: string): SecurityFinding | undefined;
    hasUnresolvedCritical(): boolean;
}
