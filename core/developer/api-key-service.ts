import { ApiKey } from "../../contracts/api-platform.js";
import crypto from "crypto";

export class ApiKeyService {
  private keys = new Map<string, ApiKey>();

  generateKey(organizationId: string, name: string, scopes: string[], expiresInDays?: number): { rawKey: string, keyRecord: ApiKey } {
    const rawSecret = crypto.randomBytes(32).toString("hex");
    const prefix = `sk_live_${rawSecret.substring(0, 8)}`;
    
    // In production we use bcrypt/argon2, simulating with sha256 for test
    const hash = crypto.createHash("sha256").update(rawSecret).digest("hex");

    const keyRecord: ApiKey = {
      keyId: `key_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      organizationId,
      name,
      prefix,
      hash,
      scopes,
      status: "ACTIVE",
      createdAt: new Date(),
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : undefined
    };

    this.keys.set(keyRecord.keyId, keyRecord);
    return { rawKey: `${prefix}.${rawSecret}`, keyRecord };
  }

  validateKey(rawKey: string, requiredScope?: string): boolean {
    const [prefix, secret] = rawKey.split(".");
    if (!prefix || !secret) return false;

    // Simulate lookup by prefix or scan (in DB, prefix is indexed)
    const keyRecord = Array.from(this.keys.values()).find(k => k.prefix === prefix);
    if (!keyRecord) return false;

    if (keyRecord.status !== "ACTIVE") return false;
    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      keyRecord.status = "EXPIRED";
      return false;
    }

    const hash = crypto.createHash("sha256").update(secret).digest("hex");
    if (keyRecord.hash !== hash) return false;

    if (requiredScope && !keyRecord.scopes.includes(requiredScope) && !keyRecord.scopes.includes("*")) {
      return false;
    }

    keyRecord.lastUsedAt = new Date();
    return true;
  }

  revokeKey(keyId: string) {
    const key = this.keys.get(keyId);
    if (key) {
      key.status = "REVOKED";
    }
  }

  listKeys(organizationId: string): ApiKey[] {
    return Array.from(this.keys.values()).filter(k => k.organizationId === organizationId);
  }
}
