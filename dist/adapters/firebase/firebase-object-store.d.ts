/**
 * `ObjectStore` backed by a Firebase Storage bucket.
 *
 * The UI never receives storage credentials — only time-limited `signedUrl`s.
 */
import type { ObjectStore, PutObjectInput, StoredObject } from "../../contracts/index.js";
import type { StorageBucketLike } from "./firebase-services.js";
export declare class FirebaseObjectStore implements ObjectStore {
    private readonly bucket;
    constructor(bucket: StorageBucketLike);
    put(input: PutObjectInput): Promise<StoredObject>;
    get(key: string): Promise<Uint8Array | undefined>;
    head(key: string): Promise<StoredObject | undefined>;
    list(prefix: string): Promise<StoredObject[]>;
    delete(key: string): Promise<boolean>;
    signedUrl(key: string, expiresInSeconds: number): Promise<string | undefined>;
}
