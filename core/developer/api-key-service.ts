import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  requireText,
  validateApiKeyScopes,
  type ApiKey,
  type ApiKeyPrincipal,
  type IssuedApiKey,
} from "../../contracts/index.js";

/**
 * Scoped server-to-server credentials.
 *
 * A key is shown to its owner exactly once, at creation. Only a salted digest
 * is retained, so a compromised store cannot be replayed against the API.
 * Every read and write is scoped to the owning organization: there is no
 * lookup path that crosses a tenant boundary.
 */

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const LOCATOR_BYTES = 4;
const MAX_NAME_LENGTH = 120;

/** Domain-separated digest so this hash is never reusable as a raw hash. */
function digestSecret(secret: string, salt: string): string {
  return `${salt}:${createHash("sha256")
    .update("api-platform/v1", "utf8")
    .update(`${salt}:${secret}`, "utf8")
    .digest("hex")}`;
}

function assertExpiry(
  expiresInDays: number | undefined,
  nowMs: number,
): string | null {
  if (expiresInDays === undefined) return null;
  if (
    typeof expiresInDays !== "number" ||
    !Number.isFinite(expiresInDays) ||
    expiresInDays <= 0 ||
    expiresInDays > 3650
  ) {
    throw new ValidationError(
      "apiKey.expiresInDays must be a positive number of days, at most 3650",
    );
  }
  return new Date(nowMs + expiresInDays * 86_400_000).toISOString();
}

/**
 * In-memory credential store. A production deployment backs this with a
 * durable store; the interface and the scoping rules are the contract that
 * store must honour.
 */
export class ApiKeyService {
  private readonly keys = new Map<string, ApiKey>();

  /**
   * @param clock Millisecond epoch source. Injected so expiry is testable
   *   without sleeping, matching `WorkflowEngine`'s clock seam.
   */
  constructor(private readonly clock: () => number = Date.now) {}

  createKey(
    organizationId: string,
    name: string,
    scopes: readonly string[],
    expiresInDays?: number,
  ): IssuedApiKey {
    requireText(organizationId, "organizationId");
    requireText(name, "apiKey.name");
    if (name.length > MAX_NAME_LENGTH) {
      throw new ValidationError(
        `apiKey.name must be at most ${MAX_NAME_LENGTH} characters`,
      );
    }
    const validatedScopes = validateApiKeyScopes(scopes);
    const expiresAt = assertExpiry(expiresInDays, this.clock());

    // The secret and the locator are drawn from independent pools, so the
    // locator never reveals key material.
    const secret = randomBytes(KEY_BYTES).toString("base64url");
    const locator = `sk_live_${randomBytes(LOCATOR_BYTES).toString("hex")}`;
    const salt = randomBytes(SALT_BYTES).toString("hex");

    const record: ApiKey = {
      keyId: `key_${randomUUID()}`,
      organizationId,
      name,
      locator,
      digest: digestSecret(secret, salt),
      scopes: validatedScopes,
      status: "ACTIVE",
      expiresAt,
      lastUsedAt: null,
      createdAt: new Date(this.clock()).toISOString(),
    };

    this.keys.set(record.keyId, record);
    return { record: this.copy(record), secret: `${locator}.${secret}` };
  }

  /**
   * Verify a presented credential. Returns the authenticated principal, or
   * `null` when the credential is unknown, revoked, expired, or malformed.
   *
   * All failure modes collapse to `null` so a caller cannot distinguish
   * "no such key" from "wrong secret".
   */
  verify(presented: unknown, requiredScope?: string): ApiKeyPrincipal | null {
    if (typeof presented !== "string") return null;
    const separator = presented.indexOf(".");
    if (separator <= 0 || separator === presented.length - 1) return null;

    const locator = presented.slice(0, separator);
    const secret = presented.slice(separator + 1);

    const record = this.findByLocator(locator);
    if (!record) return null;
    if (record.status !== "ACTIVE") return null;

    if (record.expiresAt && Date.parse(record.expiresAt) <= this.clock()) {
      record.status = "EXPIRED";
      return null;
    }

    const [salt] = record.digest.split(":");
    if (!salt) return null;

    const expected = Buffer.from(record.digest, "utf8");
    const actual = Buffer.from(digestSecret(secret, salt), "utf8");
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      return null;
    }

    if (requiredScope && !record.scopes.includes(requiredScope)) return null;

    record.lastUsedAt = new Date(this.clock()).toISOString();
    return {
      keyId: record.keyId,
      organizationId: record.organizationId,
      scopes: [...record.scopes],
    };
  }

  /**
   * Revoke a key owned by `organizationId`. A key belonging to another tenant
   * is reported as not-found rather than forbidden, so revocation cannot be
   * used to probe for key ids.
   */
  revokeKey(organizationId: string, keyId: string): ApiKey {
    requireText(organizationId, "organizationId");
    requireText(keyId, "keyId");

    const record = this.keys.get(keyId);
    if (!record || record.organizationId !== organizationId) {
      throw new NotFoundError(`api key ${keyId} not found`);
    }

    record.status = "REVOKED";
    return this.copy(record);
  }

  listKeys(organizationId: string): ApiKey[] {
    requireText(organizationId, "organizationId");
    return [...this.keys.values()]
      .filter((key) => key.organizationId === organizationId)
      .map((key) => this.copy(key));
  }

  /**
   * Assert an authenticated principal holds a scope, so scope checks happen in
   * exactly one place at the API boundary.
   */
  static requireScope(principal: ApiKeyPrincipal, scope: string): void {
    if (!principal.scopes.includes(scope)) {
      throw new PermissionDeniedError(
        `api key ${principal.keyId} lacks required scope ${scope}`,
      );
    }
  }

  private findByLocator(locator: string): ApiKey | undefined {
    for (const record of this.keys.values()) {
      if (record.locator === locator) return record;
    }
    return undefined;
  }

  private copy(record: ApiKey): ApiKey {
    return { ...record, scopes: [...record.scopes] };
  }
}
