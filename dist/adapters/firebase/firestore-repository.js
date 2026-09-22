function plain(value) {
    return JSON.parse(JSON.stringify(value));
}
export class FirestoreRepository {
    collection;
    constructor(collection) {
        this.collection = collection;
    }
    async upsert(entity) {
        await this.collection.doc(entity.id).set(plain(entity));
    }
    async findById(id) {
        const snap = await this.collection.doc(id).get();
        if (!snap.exists)
            return undefined;
        const data = snap.data();
        return data ? structuredClone(data) : undefined;
    }
    async list() {
        const snap = await this.collection.get();
        return snap.docs.map((doc) => structuredClone(doc.data()));
    }
    async delete(id) {
        const ref = this.collection.doc(id);
        const snap = await ref.get();
        if (!snap.exists)
            return false;
        await ref.delete();
        return true;
    }
    async clear() {
        const docs = await this.collection.listDocuments();
        await Promise.all(docs.map((doc) => doc.delete()));
    }
}
/** Build a `FirestoreRepository` for a named collection. */
export function firestoreRepository(firestore, collectionPath) {
    const collection = firestore.collection(collectionPath);
    return new FirestoreRepository(collection);
}
