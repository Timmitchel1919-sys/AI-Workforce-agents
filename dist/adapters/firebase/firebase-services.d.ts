export interface FirestoreDocSnapshotLike {
    readonly exists: boolean;
    data(): Record<string, unknown> | undefined;
}
export interface FirestoreQueryDocLike {
    readonly id: string;
    data(): Record<string, unknown>;
}
export interface FirestoreDocRefLike {
    set(data: Record<string, unknown>): Promise<unknown>;
    get(): Promise<FirestoreDocSnapshotLike>;
    delete(): Promise<unknown>;
}
export interface FirestoreQuerySnapshotLike {
    readonly docs: readonly FirestoreQueryDocLike[];
}
export interface FirestoreCollectionLike {
    doc(id: string): FirestoreDocRefLike;
    get(): Promise<FirestoreQuerySnapshotLike>;
    listDocuments(): Promise<readonly FirestoreDocRefLike[]>;
}
export interface FirestoreLike {
    collection(path: string): FirestoreCollectionLike;
}
/** Equality query (single-field — served by Firestore's automatic index). */
export interface FirestoreQueryLike {
    get(): Promise<FirestoreQuerySnapshotLike>;
}
export interface FirestoreQueryableCollectionLike extends FirestoreCollectionLike {
    where(field: string, op: "==", value: string): FirestoreQueryLike;
}
/** The subset of a Firestore transaction the adapters use. */
export interface FirestoreTransactionLike {
    get(ref: FirestoreDocRefLike): Promise<FirestoreDocSnapshotLike>;
    /** Fails the transaction when the document already exists. */
    create(ref: FirestoreDocRefLike, data: Record<string, unknown>): unknown;
    set(ref: FirestoreDocRefLike, data: Record<string, unknown>): unknown;
}
/** Firestore with transactions + equality queries (the Admin SDK has both). */
export interface TransactionalFirestoreLike {
    collection(path: string): FirestoreQueryableCollectionLike;
    runTransaction<T>(fn: (transaction: FirestoreTransactionLike) => Promise<T>): Promise<T>;
}
export declare function isTransactionalFirestore(firestore: FirestoreLike): firestore is FirestoreLike & TransactionalFirestoreLike;
export interface DecodedTokenLike {
    uid: string;
    [claim: string]: unknown;
}
export interface FirebaseAuthLike {
    verifyIdToken(idToken: string): Promise<DecodedTokenLike>;
}
export interface StorageFileLike {
    readonly name: string;
    save(data: Buffer | string, options?: {
        contentType?: string;
        metadata?: {
            metadata?: Record<string, string>;
        };
    }): Promise<unknown>;
    download(): Promise<[Buffer]>;
    exists(): Promise<[boolean]>;
    getMetadata(): Promise<[Record<string, unknown>]>;
    delete(): Promise<unknown>;
    getSignedUrl(options: {
        action: "read";
        expires: number;
    }): Promise<[string]>;
}
export interface StorageBucketLike {
    file(key: string): StorageFileLike;
    getFiles(options: {
        prefix: string;
    }): Promise<[readonly StorageFileLike[]]>;
}
export interface FirebaseStorageLike {
    bucket(name?: string): StorageBucketLike;
}
export interface FirebaseConfig {
    projectId: string;
    storageBucket: string;
    /** True when a Firestore emulator host is configured — no credentials needed. */
    emulated: boolean;
    /** Explicit service-account key path, if `GOOGLE_APPLICATION_CREDENTIALS` is set. */
    credentialsPath?: string;
}
type EnvLike = Record<string, string | undefined>;
export declare function loadFirebaseConfig(env?: EnvLike): FirebaseConfig;
export interface FirebaseServices {
    firestore: FirestoreLike;
    auth: FirebaseAuthLike;
    storage: FirebaseStorageLike;
    config: FirebaseConfig;
}
/**
 * Initialise (or reuse) the Firebase app and return the three service seams.
 * Never throws with a credential in the message.
 */
export declare function createFirebaseServices(config?: FirebaseConfig): Promise<FirebaseServices>;
export {};
