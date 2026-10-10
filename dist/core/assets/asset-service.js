export class AssetService {
    assets = new Map();
    lifecycleEvents = new Map();
    async registerAsset(asset) {
        if (this.assets.has(asset.assetId)) {
            throw new Error(`Asset ${asset.assetId} already exists`);
        }
        this.assets.set(asset.assetId, asset);
        return asset;
    }
    async getAsset(organizationId, assetId) {
        const asset = this.assets.get(assetId);
        if (!asset)
            throw new Error("Asset not found");
        if (asset.organizationId !== organizationId)
            throw new Error("Tenant isolation violation: Cannot access asset across organizations.");
        return asset;
    }
    async updateAssetStatus(organizationId, assetId, newStatus, actorRef, notes) {
        const asset = await this.getAsset(organizationId, assetId);
        const oldStatus = asset.status;
        asset.status = newStatus;
        asset.updatedAt = new Date().toISOString();
        const eventId = `evt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        this.lifecycleEvents.set(eventId, {
            id: eventId,
            eventId,
            organizationId,
            assetId,
            eventType: "STATUS_CHANGED",
            actorRef,
            previousState: oldStatus,
            newState: newStatus,
            notes,
            timestamp: asset.updatedAt
        });
        return asset;
    }
    async getAssetLifecycle(organizationId, assetId) {
        // Verifies tenant access
        await this.getAsset(organizationId, assetId);
        return Array.from(this.lifecycleEvents.values())
            .filter(e => e.assetId === assetId && e.organizationId === organizationId)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
}
