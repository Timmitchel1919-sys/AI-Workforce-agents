/**
 * Non-serializable, non-enumerable wrapper around raw secret values.
 * Prevents accidental logging, JSON serialization, or console inspection of credentials.
 *
 * CRITICAL INVARIANTS:
 * 1. `_value` property is non-enumerable.
 * 2. `toJSON()`, `toString()`, and Node `inspect()` return `[REDACTED_SECRET_VALUE]`.
 * 3. `reveal()` is the ONLY way to access the underlying string value (internal tool use only).
 */
export class SecretValue {
  private readonly _value: string;
  private readonly _expiresAt?: string;
  private readonly _version?: string;

  constructor(value: string, options?: { expiresAt?: string; version?: string }) {
    this._value = value;
    this._expiresAt = options?.expiresAt;
    this._version = options?.version;
    Object.defineProperty(this, "_value", { enumerable: false, writable: false });
  }

  /**
   * Internal-only method to reveal the underlying secret string.
   * MUST be discarded from local scope immediately after use.
   */
  reveal(): string {
    return this._value;
  }

  get version(): string | undefined {
    return this._version;
  }

  get expiresAt(): string | undefined {
    return this._expiresAt;
  }

  toJSON(): string {
    return "[REDACTED_SECRET_VALUE]";
  }

  toString(): string {
    return "[REDACTED_SECRET_VALUE]";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[REDACTED_SECRET_VALUE]";
  }
}
