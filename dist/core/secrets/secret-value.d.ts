/**
 * Non-serializable, non-enumerable wrapper around raw secret values.
 * Prevents accidental logging, JSON serialization, or console inspection of credentials.
 *
 * CRITICAL INVARIANTS:
 * 1. `_value` property is non-enumerable.
 * 2. `toJSON()`, `toString()`, and Node `inspect()` return `[REDACTED_SECRET_VALUE]`.
 * 3. `reveal()` is the ONLY way to access the underlying string value (internal tool use only).
 */
export declare class SecretValue {
    private readonly _value;
    private readonly _expiresAt?;
    private readonly _version?;
    constructor(value: string, options?: {
        expiresAt?: string;
        version?: string;
    });
    /**
     * Internal-only method to reveal the underlying secret string.
     * MUST be discarded from local scope immediately after use.
     */
    reveal(): string;
    get version(): string | undefined;
    get expiresAt(): string | undefined;
    toJSON(): string;
    toString(): string;
}
