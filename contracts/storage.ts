/**
 * Object storage contract.
 *
 * A provider-neutral blob store for artifacts that do not belong in the
 * structured repositories — future "Knowledge" documents, exported reports,
 * large tool outputs. Firebase Storage is the first adapter (ADR-0011); an S3 or
 * local-disk adapter would implement the same interface.
 *
 * No core system consumes this yet. It exists so the storage seam in the
 * Phase 7B target architecture is a real, typed port rather than an ad-hoc
 * Firebase call.
 */

export interface StoredObject {
  /** Storage key / path, e.g. `projects/aims/knowledge/spec.md`. */
  key: string;
  size: number;
  contentType: string;
  updatedAt: string;
}

export interface PutObjectInput {
  key: string;
  data: Uint8Array | string;
  contentType?: string;
  /** Small, non-sensitive key/value pairs. Never secrets. */
  metadata?: Record<string, string>;
}

export interface ObjectStore {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | undefined>;
  head(key: string): Promise<StoredObject | undefined>;
  list(prefix: string): Promise<StoredObject[]>;
  delete(key: string): Promise<boolean>;
  /**
   * A time-limited read URL for a stored object, or `undefined` if the object
   * does not exist. The UI receives only these — never storage credentials.
   */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | undefined>;
}
