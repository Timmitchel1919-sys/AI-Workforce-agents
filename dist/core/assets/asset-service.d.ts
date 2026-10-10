import { EnterpriseAsset, AssetLifecycleEvent, AssetState } from "../../contracts/assets.js";
export declare class AssetService {
    private assets;
    private lifecycleEvents;
    registerAsset(asset: EnterpriseAsset): Promise<EnterpriseAsset>;
    getAsset(organizationId: string, assetId: string): Promise<EnterpriseAsset>;
    updateAssetStatus(organizationId: string, assetId: string, newStatus: AssetState, actorRef: string, notes: string): Promise<EnterpriseAsset>;
    getAssetLifecycle(organizationId: string, assetId: string): Promise<AssetLifecycleEvent[]>;
}
