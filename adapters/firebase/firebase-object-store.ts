/**
 * `ObjectStore` backed by a Firebase Storage bucket.
 *
 * The UI never receives storage credentials — only time-limited `signedUrl`s.
 */
import type {
  ObjectStore,
  PutObjectInput,
  StoredObject,
} from "../../contracts/index.js";
import type {
  StorageBucketLike,
  StorageFileLike,
} from "./firebase-services.js";

function toStoredObject(
  key: string,
  metadata: Record<string, unknown>,
): StoredObject {
  return {
    key,
    size: Number(metadata.size ?? 0),
    contentType: String(metadata.contentType ?? "application/octet-stream"),
    updatedAt: String(metadata.updated ?? metadata.timeCreated ?? ""),
  };
}

export class FirebaseObjectStore implements ObjectStore {
  constructor(private readonly bucket: StorageBucketLike) {}

  async put(input: PutObjectInput): Promise<StoredObject> {
    const file = this.bucket.file(input.key);
    const data =
      typeof input.data === "string"
        ? Buffer.from(input.data, "utf8")
        : Buffer.from(input.data);
    await file.save(data, {
      contentType: input.contentType ?? "application/octet-stream",
      ...(input.metadata ? { metadata: { metadata: input.metadata } } : {}),
    });
    const [metadata] = await file.getMetadata();
    return toStoredObject(input.key, metadata);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const file = this.bucket.file(key);
    const [exists] = await file.exists();
    if (!exists) return undefined;
    const [buffer] = await file.download();
    return new Uint8Array(buffer);
  }

  async head(key: string): Promise<StoredObject | undefined> {
    const file = this.bucket.file(key);
    const [exists] = await file.exists();
    if (!exists) return undefined;
    const [metadata] = await file.getMetadata();
    return toStoredObject(key, metadata);
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const [files] = await this.bucket.getFiles({ prefix });
    return Promise.all(
      files.map(async (file: StorageFileLike) => {
        const [metadata] = await file.getMetadata();
        return toStoredObject(file.name, metadata);
      }),
    );
  }

  async delete(key: string): Promise<boolean> {
    const file = this.bucket.file(key);
    const [exists] = await file.exists();
    if (!exists) return false;
    await file.delete();
    return true;
  }

  async signedUrl(
    key: string,
    expiresInSeconds: number,
  ): Promise<string | undefined> {
    const file = this.bucket.file(key);
    const [exists] = await file.exists();
    if (!exists) return undefined;
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + Math.max(1, expiresInSeconds) * 1000,
    });
    return url;
  }
}
