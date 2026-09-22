function toStoredObject(key, metadata) {
    return {
        key,
        size: Number(metadata.size ?? 0),
        contentType: String(metadata.contentType ?? "application/octet-stream"),
        updatedAt: String(metadata.updated ?? metadata.timeCreated ?? ""),
    };
}
export class FirebaseObjectStore {
    bucket;
    constructor(bucket) {
        this.bucket = bucket;
    }
    async put(input) {
        const file = this.bucket.file(input.key);
        const data = typeof input.data === "string"
            ? Buffer.from(input.data, "utf8")
            : Buffer.from(input.data);
        await file.save(data, {
            contentType: input.contentType ?? "application/octet-stream",
            ...(input.metadata ? { metadata: { metadata: input.metadata } } : {}),
        });
        const [metadata] = await file.getMetadata();
        return toStoredObject(input.key, metadata);
    }
    async get(key) {
        const file = this.bucket.file(key);
        const [exists] = await file.exists();
        if (!exists)
            return undefined;
        const [buffer] = await file.download();
        return new Uint8Array(buffer);
    }
    async head(key) {
        const file = this.bucket.file(key);
        const [exists] = await file.exists();
        if (!exists)
            return undefined;
        const [metadata] = await file.getMetadata();
        return toStoredObject(key, metadata);
    }
    async list(prefix) {
        const [files] = await this.bucket.getFiles({ prefix });
        return Promise.all(files.map(async (file) => {
            const [metadata] = await file.getMetadata();
            return toStoredObject(file.name, metadata);
        }));
    }
    async delete(key) {
        const file = this.bucket.file(key);
        const [exists] = await file.exists();
        if (!exists)
            return false;
        await file.delete();
        return true;
    }
    async signedUrl(key, expiresInSeconds) {
        const file = this.bucket.file(key);
        const [exists] = await file.exists();
        if (!exists)
            return undefined;
        const [url] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + Math.max(1, expiresInSeconds) * 1000,
        });
        return url;
    }
}
