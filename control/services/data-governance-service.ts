import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import { ValidationError } from "../../contracts/index.js";
import type {
  DataAsset,
  DataRetentionPolicy,
  DataSubjectRequestRecord,
} from "../../contracts/data-governance.js";

export class DataGovernanceService {
  constructor(
    private readonly assets: Repository<DataAsset>,
    private readonly retentionPolicies: Repository<DataRetentionPolicy>,
    private readonly dsrs: Repository<DataSubjectRequestRecord>
  ) {}

  private enforceAdmin(operator: OperatorPrincipal) {
    if (operator.role !== "admin") {
      throw new ValidationError("Unauthorized. Requires admin role for Data Governance operations.");
    }
  }

  async listAssets(): Promise<DataAsset[]> {
    return this.assets.list();
  }

  async registerAsset(
    operator: OperatorPrincipal,
    asset: Omit<DataAsset, "id" | "assetId" | "status" | "createdAt" | "updatedAt">
  ): Promise<DataAsset> {
    this.enforceAdmin(operator);
    
    const newAsset: DataAsset = {
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

  async listRetentionPolicies(): Promise<DataRetentionPolicy[]> {
    return this.retentionPolicies.list();
  }
}
