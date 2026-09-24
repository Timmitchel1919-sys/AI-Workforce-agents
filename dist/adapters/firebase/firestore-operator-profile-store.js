export const OPERATOR_PROFILES_COLLECTION = "operator_profiles";
export class FirestoreOperatorProfileStore {
    collection;
    constructor(firestore, options = {}) {
        this.collection = firestore.collection((options.collectionPrefix ?? "") + OPERATOR_PROFILES_COLLECTION);
    }
    async get(operatorId) {
        const snap = await this.collection.doc(operatorId).get();
        const data = snap.exists ? snap.data() : undefined;
        if (!data || typeof data.id !== "string")
            return undefined;
        return {
            id: data.id,
            ...(typeof data.avatarDataUrl === "string"
                ? { avatarDataUrl: data.avatarDataUrl }
                : {}),
            updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
        };
    }
    async save(profile) {
        await this.collection
            .doc(profile.id)
            .set(JSON.parse(JSON.stringify(profile)));
    }
    async remove(operatorId) {
        await this.collection.doc(operatorId).delete();
    }
}
