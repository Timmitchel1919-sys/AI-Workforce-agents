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
export {};
