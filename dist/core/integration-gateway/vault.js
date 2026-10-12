/**
 * Credential vault + OAuth.
 *
 * Credentials are stored only as AES-256-GCM ciphertext, and are handed to the
 * code that needs them through `use(ref, fn)` — never returned, never
 * serialized. `Secret` prints as "[secret]" however it is logged or JSON-ified.
 * Without a configured key the vault refuses to store anything (it can still
 * RESOLVE `env:NAME` references to server-side environment variables). Agents
 * and the UI only ever see a reference id and metadata.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, } from "node:crypto";
import { inspect } from "node:util";
import { HUB_LIMITS } from "../../contracts/integration-gateway.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
export class Secret {
    #value;
    constructor(value) {
        this.#value = value;
    }
    reveal() {
        return this.#value;
    }
    toString() {
        return "[secret]";
    }
    toJSON() {
        return "[secret]";
    }
    [inspect.custom]() {
        return "[secret]";
    }
}
export class VaultError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "VaultError";
    }
}
function parseKey(raw) {
    if (!raw)
        return undefined;
    const buf = /^[A-Za-z0-9+/=]+$/.test(raw) && raw.length >= 43
        ? Buffer.from(raw, "base64")
        : createHash("sha256").update(raw).digest();
    return buf.length === 32 ? buf : createHash("sha256").update(raw).digest();
}
export class CredentialVault {
    clock;
    repo;
    key;
    uses = {};
    constructor(repo, clock, options = {}) {
        this.clock = clock;
        this.repo = new SyncCache(repo);
        this.key = parseKey(options.key ?? process.env["AI_WORKFORCE_VAULT_KEY"]);
        this.env = options.env ?? process.env;
    }
    env;
    /** True when secrets can be stored (a key is configured). */
    get canStore() {
        return this.key !== undefined;
    }
    seal(plain) {
        if (!this.key)
            throw new VaultError("no_key", "the credential vault has no encryption key configured (AI_WORKFORCE_VAULT_KEY); credentials cannot be stored");
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.key, iv);
        const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
        return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
    }
    unseal(sealed) {
        if (!this.key)
            throw new VaultError("no_key", "the credential vault has no encryption key configured");
        const [iv, tag, data] = sealed.split(":");
        if (!iv || !tag || !data)
            throw new VaultError("tampered", "the stored credential is malformed");
        try {
            const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
            d.setAuthTag(Buffer.from(tag, "base64"));
            return Buffer.concat([
                d.update(Buffer.from(data, "base64")),
                d.final(),
            ]).toString("utf8");
        }
        catch {
            throw new VaultError("tampered", "the stored credential could not be decrypted");
        }
    }
    static refFor(connectorId, purpose = "primary") {
        return `cred:${connectorId}:${purpose}`;
    }
    store(input) {
        if (!input.value || input.value.length > 20_000)
            throw new VaultError("invalid", "the credential value is empty or too long");
        const now = this.clock();
        const existing = this.repo.findById(input.ref);
        const record = {
            id: input.ref,
            ref: input.ref,
            connectorId: input.connectorId,
            kind: input.kind,
            sealed: this.seal(input.value),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
            createdBy: input.by,
        };
        this.repo.upsert(record);
        return this.meta(record);
    }
    has(ref) {
        return this.repo.findById(ref) !== undefined || ref.startsWith("env:");
    }
    meta(r) {
        return {
            ref: r.ref,
            connectorId: r.connectorId,
            kind: r.kind,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            expiresAt: r.expiresAt ?? null,
            createdBy: r.createdBy,
        };
    }
    metadata(ref) {
        const r = this.repo.findById(ref);
        return r ? this.meta(r) : undefined;
    }
    list(connectorId) {
        return this.repo
            .list()
            .filter((r) => !connectorId || r.connectorId === connectorId)
            .map((r) => this.meta(r));
    }
    revoke(ref) {
        return this.repo.delete(ref);
    }
    /**
     * Run `fn` with the secret. The secret is never returned; only what `fn` returns leaves.
     * `env:NAME` references resolve to a server-side environment variable.
     */
    async use(ref, purpose, fn) {
        let value;
        if (ref.startsWith("env:")) {
            value = this.env[ref.slice(4)];
            if (!value)
                throw new VaultError("not_found", `the server environment variable for ${ref} is not set`);
        }
        else {
            const r = this.repo.findById(ref);
            if (!r)
                throw new VaultError("not_found", "no credential is stored for this connector");
            if (r.expiresAt &&
                Date.parse(r.expiresAt) <= Date.parse(this.clock()) &&
                r.kind !== "oauth2")
                throw new VaultError("expired", "the stored credential has expired");
            value = this.unseal(r.sealed);
        }
        this.uses[purpose] = (this.uses[purpose] ?? 0) + 1;
        return fn(new Secret(value));
    }
}
const b64url = (b) => b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export class OAuthManager {
    vault;
    clock;
    fetchImpl;
    env;
    states;
    constructor(states, vault, clock, fetchImpl = globalThis.fetch, env = process.env) {
        this.vault = vault;
        this.clock = clock;
        this.fetchImpl = fetchImpl;
        this.env = env;
        this.states = new SyncCache(states);
    }
    isConfigured(cfg) {
        return Boolean(this.env[cfg.clientIdEnv] && this.env[cfg.clientSecretEnv]);
    }
    begin(connectorId, cfg, redirectUri, by) {
        const clientId = this.env[cfg.clientIdEnv];
        if (!clientId || !this.env[cfg.clientSecretEnv])
            throw new VaultError("invalid", `OAuth is not configured on the server (${cfg.clientIdEnv} / ${cfg.clientSecretEnv})`);
        if (!/^https:\/\/|^http:\/\/localhost/.test(redirectUri))
            throw new VaultError("invalid", "the redirect URI must be https");
        const state = b64url(randomBytes(24));
        const verifier = b64url(randomBytes(32));
        const challenge = b64url(createHash("sha256").update(verifier).digest());
        const expiresAt = new Date(Date.parse(this.clock()) + HUB_LIMITS.oauthStateTtlMs).toISOString();
        const stateHash = createHash("sha256").update(state).digest("hex");
        this.states.upsert({
            id: stateHash,
            stateHash,
            connectorId,
            verifier,
            redirectUri,
            by,
            expiresAt,
            used: false,
        });
        const url = new URL(cfg.authorizeUrl);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("scope", cfg.scopes.join(" "));
        url.searchParams.set("state", state);
        url.searchParams.set("code_challenge", challenge);
        url.searchParams.set("code_challenge_method", "S256");
        for (const [k, v] of Object.entries(cfg.extraAuthorizeParams ?? {}))
            url.searchParams.set(k, v);
        return { authorizeUrl: url.toString(), expiresAt };
    }
    async tokenRequest(cfg, params) {
        const body = cfg.jsonTokenRequest
            ? JSON.stringify(params)
            : new URLSearchParams(params).toString();
        const res = await this.fetchImpl(cfg.tokenUrl, {
            method: "POST",
            redirect: "manual",
            headers: {
                "content-type": cfg.jsonTokenRequest
                    ? "application/json"
                    : "application/x-www-form-urlencoded",
                accept: "application/json",
            },
            body,
        });
        const text = await res.text();
        let json = {};
        try {
            json = JSON.parse(text);
        }
        catch {
            /* some providers answer form-encoded */
            json = Object.fromEntries(new URLSearchParams(text));
        }
        if (!res.ok || typeof json["access_token"] !== "string")
            throw new VaultError("invalid", `the provider refused the token request (${res.status}): ${maskSecrets(String(json["error_description"] ?? json["error"] ?? "no access token")).slice(0, 120)}`);
        return json;
    }
    /** Complete the code exchange. The state is single-use and expires. */
    async complete(state, code, cfg, by) {
        const stateHash = createHash("sha256").update(state).digest("hex");
        const rec = this.states.findById(stateHash);
        if (!rec || rec.used)
            throw new VaultError("invalid", "unknown or already used OAuth state");
        if (Date.parse(rec.expiresAt) <= Date.parse(this.clock()))
            throw new VaultError("expired", "the OAuth authorization expired; start again");
        this.states.upsert({ ...rec, used: true });
        const clientId = this.env[cfg.clientIdEnv];
        const json = await this.tokenRequest(cfg, {
            grant_type: "authorization_code",
            code,
            redirect_uri: rec.redirectUri,
            client_id: clientId,
            client_secret: this.env[cfg.clientSecretEnv],
            code_verifier: rec.verifier,
        });
        const expiresIn = typeof json["expires_in"] === "number" ? json["expires_in"] : undefined;
        const expiresAt = expiresIn
            ? new Date(Date.parse(this.clock()) + expiresIn * 1000).toISOString()
            : undefined;
        this.vault.store({
            ref: CredentialVault.refFor(rec.connectorId),
            connectorId: rec.connectorId,
            kind: "oauth2",
            value: JSON.stringify({
                access_token: json["access_token"],
                refresh_token: json["refresh_token"] ?? null,
                expires_at: expiresAt ?? null,
            }),
            by,
            ...(expiresAt ? { expiresAt } : {}),
        });
        return {
            connectorId: rec.connectorId,
            ...(expiresAt ? { expiresAt } : {}),
        };
    }
    /** Access token for a connector, refreshing it first when it expires within a minute. */
    async accessToken(connectorId, cfg, fn) {
        const ref = CredentialVault.refFor(connectorId);
        const parsed = await this.vault.use(ref, "oauth.read", (s) => JSON.parse(s.reveal()));
        let access = parsed.access_token;
        if (parsed.expires_at &&
            Date.parse(parsed.expires_at) - Date.parse(this.clock()) < 60_000) {
            if (!parsed.refresh_token || !cfg)
                throw new VaultError("expired", "the access token expired and cannot be refreshed; reconnect the integration");
            const json = await this.tokenRequest(cfg, {
                grant_type: "refresh_token",
                refresh_token: parsed.refresh_token,
                client_id: this.env[cfg.clientIdEnv],
                client_secret: this.env[cfg.clientSecretEnv],
            });
            access = String(json["access_token"]);
            const expiresIn = typeof json["expires_in"] === "number" ? json["expires_in"] : undefined;
            const expiresAt = expiresIn
                ? new Date(Date.parse(this.clock()) + expiresIn * 1000).toISOString()
                : null;
            this.vault.store({
                ref,
                connectorId,
                kind: "oauth2",
                value: JSON.stringify({
                    access_token: access,
                    refresh_token: json["refresh_token"] ??
                        parsed.refresh_token,
                    expires_at: expiresAt,
                }),
                by: "oauth-refresh",
                ...(expiresAt ? { expiresAt } : {}),
            });
        }
        return fn(new Secret(access));
    }
    /** Revoke at the provider when it supports it, then forget the credential either way. */
    async revoke(connectorId, cfg) {
        const ref = CredentialVault.refFor(connectorId);
        let revokedAtProvider = false;
        if (cfg?.revokeUrl && this.vault.has(ref)) {
            try {
                await this.vault.use(ref, "oauth.revoke", async (s) => {
                    const tok = JSON.parse(s.reveal())
                        .access_token;
                    const res = await this.fetchImpl(cfg.revokeUrl, {
                        method: "POST",
                        redirect: "manual",
                        headers: { "content-type": "application/x-www-form-urlencoded" },
                        body: new URLSearchParams({ token: tok }).toString(),
                    });
                    revokedAtProvider = res.ok;
                });
            }
            catch {
                /* the local credential is still removed */
            }
        }
        this.vault.revoke(ref);
        return { revokedAtProvider };
    }
}
