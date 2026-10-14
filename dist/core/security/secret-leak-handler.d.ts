import type { AsyncSecurityEventStore, ManagedSecretReference, Repository, SecurityFinding } from "../../contracts/index.js";
import type { SecurityFindingStore } from "./security-finding-source.js";
export interface SecretLeakReport {
    file: string;
    line?: number;
    ruleId: string;
    description: string;
    secretHash?: string;
    matchedReferenceId?: string;
}
export declare class SecretLeakHandler {
    private readonly findingStore;
    private readonly secretRepo;
    private readonly securityEvents?;
    private readonly clock;
    constructor(findingStore: SecurityFindingStore, secretRepo: Repository<ManagedSecretReference>, securityEvents?: AsyncSecurityEventStore | undefined, clock?: () => string);
    handleLeak(report: SecretLeakReport): Promise<SecurityFinding>;
}
