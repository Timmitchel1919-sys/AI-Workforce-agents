import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import type { DataAsset, DataRetentionPolicy, DataSubjectRequestRecord } from "../../contracts/data-governance.js";
export declare class DataGovernanceService {
    private readonly assets;
    private readonly retentionPolicies;
    private readonly dsrs;
    constructor(assets: Repository<DataAsset>, retentionPolicies: Repository<DataRetentionPolicy>, dsrs: Repository<DataSubjectRequestRecord>);
    private enforceAdmin;
    listAssets(): Promise<DataAsset[]>;
    registerAsset(operator: OperatorPrincipal, asset: Omit<DataAsset, "id" | "assetId" | "status" | "createdAt" | "updatedAt">): Promise<DataAsset>;
    listRetentionPolicies(): Promise<DataRetentionPolicy[]>;
}
