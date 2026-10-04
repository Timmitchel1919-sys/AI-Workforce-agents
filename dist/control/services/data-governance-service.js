import { ValidationError } from "../../contracts/index.js";
export class DataGovernanceService {
    assets;
    retentionPolicies;
    dsrs;
    constructor(assets, retentionPolicies, dsrs) {
        this.assets = assets;
        this.retentionPolicies = retentionPolicies;
        this.dsrs = dsrs;
    }
    enforceAdmin(operator) {
        if (operator.role !== "admin") {
            throw new ValidationError("Unauthorized. Requires admin role for Data Governance operations.");
        }
    }
    async listAssets() {
        return this.assets.list();
    }
    async registerAsset(operator, asset) {
        this.enforceAdmin(operator);
        const newAsset = {
            ...asset,
            id: `data_asset_${Date.now()}`,
            assetId: `data_asset_${Date.now()}`,
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.assets.upsert(newAsset);
        return newAsset;
    }
    async listRetentionPolicies() {
        return this.retentionPolicies.list();
    }
}
