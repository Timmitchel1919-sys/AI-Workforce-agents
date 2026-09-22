function defaultId() {
    const c = globalThis.crypto;
    return c?.randomUUID ? c.randomUUID() : `evt_${Date.now()}_${Math.random()}`;
}
export class FirestoreEventPublisher {
    collection;
    now;
    generateId;
    onError;
    constructor(collection, options = {}) {
        this.collection = collection;
        this.now = options.now ?? (() => new Date().toISOString());
        this.generateId = options.generateId ?? defaultId;
        this.onError = options.onError ?? (() => { });
    }
    publish(event) {
        try {
            const id = this.generateId();
            const record = {
                id,
                at: this.now(),
                ...JSON.parse(JSON.stringify(event)),
            };
            void Promise.resolve()
                .then(() => this.collection.doc(id).set(record))
                .catch((error) => this.onError(error));
        }
        catch (error) {
            this.onError(error);
        }
    }
}
