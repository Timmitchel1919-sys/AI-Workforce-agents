/** In-memory `OperatorProfileStore` (tests, local runs). */
export class InMemoryOperatorProfileStore {
    profiles = new Map();
    async get(operatorId) {
        const profile = this.profiles.get(operatorId);
        return profile ? structuredClone(profile) : undefined;
    }
    async save(profile) {
        this.profiles.set(profile.id, structuredClone(profile));
    }
    async remove(operatorId) {
        this.profiles.delete(operatorId);
    }
}
