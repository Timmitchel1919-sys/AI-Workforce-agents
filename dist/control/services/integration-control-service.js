/**
 * IntegrationControlService — the Integration Center's governed read/command surface.
 *
 * Reads need `view` (project-bound data also needs project access). Commands need
 * `manage_integrations`; the consequential ones — storing a credential, going live,
 * raising trust, enabling a connector, registering an MCP server — are
 * administrator-only. A credential value travels in exactly one command body, goes
 * straight into the vault and is never echoed, audited or returned.
 */
import { NotFoundError, PermissionDeniedError, StateTransitionError, ValidationError, operatorCan, operatorCanAccessProject, } from "../../contracts/index.js";
import { INTEGRATION_COMMANDS, OPERATION_CLASSES, } from "../../contracts/integration-gateway.js";
import { GOV_ENVIRONMENTS, TRUST_STATES, } from "../../contracts/security-governance.js";
import { EventHub, HubError, VaultError, CredentialVault, } from "../../core/index.js";
import { resolveCorrelationId } from "../correlation.js";
import { redact } from "../redaction.js";
const str = (v, name, required = true, max = 4000) => {
    if (v === undefined || v === null || v === "") {
        if (required)
            throw new ValidationError(`${name} is required`);
        return undefined;
    }
    if (typeof v !== "string")
        throw new ValidationError(`${name} must be a string`);
    if (v.length > max)
        throw new ValidationError(`${name} is too long`);
    return v;
};
const one = (v, list, name, required = true) => {
    if (v === undefined || v === null || v === "") {
        if (required)
            throw new ValidationError(`${name} is required`);
        return undefined;
    }
    if (typeof v !== "string" || !list.includes(v))
        throw new ValidationError(`${name} must be one of: ${list.join(", ")}`);
    return v;
};
export class IntegrationControlService {
    deps;
    clock;
    i;
    s;
    constructor(deps) {
        this.deps = deps;
        this.i = deps.integrations;
        this.s = deps.security;
        this.clock = deps.clock ?? (() => new Date().toISOString());
    }
    reader(p) {
        if (!operatorCan(p, "view"))
            throw new PermissionDeniedError("insufficient capabilities");
    }
    project(p, projectId) {
        if (projectId !== undefined && !operatorCanAccessProject(p, projectId))
            throw new NotFoundError("project not found");
    }
    seen(p, projectId) {
        return projectId === undefined || operatorCanAccessProject(p, projectId);
    }
    /* ---------------------------- reads ---------------------------- */
    connectorView(id, p) {
        const c = this.i.registry.require(id);
        const m = this.i.registry.manifest(id);
        const caps = m.capabilities;
        const mappings = this.i.registry
            .mappings_()
            .filter((x) => x.connectorId === id &&
            x.status === "ACTIVE" &&
            this.seen(p, x.projectId));
        const last = this.i.gateway
            .activityLog({ connectorId: id, limit: 1 })
            .filter((a) => this.seen(p, a.projectId))[0];
        return {
            connectorId: c.connectorId,
            provider: c.provider,
            name: c.name,
            description: c.description,
            kind: c.kind,
            family: c.family,
            version: c.version,
            providerApiVersion: c.providerApiVersion,
            status: c.status,
            trust: c.trust,
            mode: c.mode,
            enabled: c.enabled,
            auth: {
                method: c.auth.method,
                scopes: c.auth.scopes,
                credentialConfigured: c.auth.credentialConfigured,
                connectedAt: c.auth.connectedAt ?? null,
                expiresAt: c.auth.expiresAt ?? null,
                oauthAvailable: Boolean(m.oauth && this.i.oauth.isConfigured(m.oauth)),
            },
            config: {
                baseUrl: c.config.baseUrl ?? null,
                environment: c.config.environment ?? null,
                settings: c.config.settings ?? {},
            },
            capabilities: {
                total: caps.length,
                available: caps.filter((x) => !x.unavailable).length,
                reads: caps.filter((x) => !x.unavailable && x.operation === "READ")
                    .length,
                sideEffects: caps.filter((x) => !x.unavailable && x.operation !== "READ").length,
            },
            health: c.health,
            events: c.events,
            environments: c.environments,
            costClass: c.costClass,
            installation: c.installation,
            projects: [...new Set(mappings.map((x) => x.projectId))],
            lastActivity: last
                ? { at: last.at, capability: last.capability, outcome: last.outcome }
                : null,
            updatedAt: c.updatedAt,
        };
    }
    overview(p, projectId) {
        this.reader(p);
        this.project(p, projectId);
        const connectors = this.i.registry
            .list()
            .map((c) => this.connectorView(c.connectorId, p));
        const count = (s) => connectors.filter((c) => c.status === s).length;
        const activity = this.i.gateway
            .activityLog({ ...(projectId ? { projectId } : {}), limit: 50 })
            .filter((a) => this.seen(p, a.projectId));
        return {
            summary: {
                connectors: connectors.length,
                healthy: count("HEALTHY"),
                degraded: count("DEGRADED"),
                error: count("ERROR"),
                disconnected: count("DISCONNECTED") + count("DISCOVERED"),
                disabled: count("DISABLED"),
                waitingApproval: activity.filter((a) => a.outcome === "WAITING_APPROVAL").length,
                blocked24h: activity.filter((a) => a.outcome === "DENIED" || a.outcome === "BLOCKED").length,
                queued: this.i.gateway.queued().filter((q) => q.status === "QUEUED")
                    .length,
            },
            connectors,
            recentActivity: activity.slice(0, 15),
            vault: {
                canStoreCredentials: this.i.vault.canStore,
                note: this.i.vault.canStore
                    ? "Credentials are encrypted at rest."
                    : "No vault key is configured on the server: credentials cannot be stored, only server-side environment references are used.",
            },
            capabilities: {
                mcp: this.i.mcp.list().length,
                webhooks: true,
                oauthProviders: this.i.registry
                    .manifestsList()
                    .filter((m) => m.oauth && this.i.oauth.isConfigured(m.oauth)).length,
            },
            generatedAt: this.clock(),
        };
    }
    connector(p, id) {
        this.reader(p);
        const view = this.connectorView(id, p);
        const m = this.i.registry.manifest(id);
        const caps = m.capabilities.map((c) => ({
            capability: c.capability,
            description: c.description,
            operation: c.operation,
            risk: c.risk,
            version: c.version,
            permissions: c.permissions,
            sandbox: typeof c.sandbox === "object"
                ? `substitute with ${c.sandbox.substitute}`
                : c.sandbox === "ALLOW"
                    ? "allowed"
                    : "blocked",
            approval: c.operation === "READ"
                ? "none"
                : ["PUBLISH", "SEND", "DEPLOY", "DELETE"].includes(c.operation)
                    ? "always"
                    : "likely",
            queueable: c.queueable,
            unavailable: c.unavailable ?? null,
            params: c.params,
        }));
        const mappings = this.i.registry
            .mappings_()
            .filter((x) => x.connectorId === id && this.seen(p, x.projectId));
        return {
            ...view,
            capabilityList: caps,
            mappings,
            credentials: this.i.vault
                .list(id)
                .map((x) => ({
                ref: x.ref,
                kind: x.kind,
                createdAt: x.createdAt,
                updatedAt: x.updatedAt,
                expiresAt: x.expiresAt,
            })),
            webhook: {
                configured: this.i.vault.has(EventHub.webhookRef(id)),
                endpoint: `/api/integrations/webhooks/${id}`,
            },
            activity: this.i.gateway
                .activityLog({ connectorId: id, limit: 25 })
                .filter((a) => this.seen(p, a.projectId)),
            events: this.i.events
                .list({ limit: 25 })
                .filter((e) => e.connectorId === id && this.seen(p, e.projectId)),
            securityValidation: this.i.registry.validateSecurity(id),
        };
    }
    /** Tool Explorer: search capabilities across providers. */
    capabilities(p, params) {
        this.reader(p);
        const projectId = params.get("projectId") ?? undefined;
        this.project(p, projectId);
        const q = (params.get("q") ?? "").toLowerCase().trim();
        const rows = this.i.registry
            .allCapabilities()
            .filter((c) => !q ||
            `${c.capability} ${c.description} ${c.provider} ${c.family}`
                .toLowerCase()
                .includes(q))
            .map((c) => {
            const connector = this.i.registry.get(c.connectorId);
            const mapped = projectId
                ? this.i.registry.mappingFor(projectId, c.connectorId).length > 0
                : null;
            return {
                ...c,
                status: connector?.status ?? "DISCOVERED",
                mode: connector?.mode ?? "SANDBOX",
                trust: connector?.trust ?? "LIMITED",
                approval: c.operation === "READ"
                    ? "none"
                    : ["PUBLISH", "SEND", "DEPLOY", "DELETE"].includes(c.operation)
                        ? "always"
                        : "likely",
                mappedToProject: mapped,
            };
        });
        const mcp = projectId
            ? this.i.mcp
                .capabilities(projectId)
                .filter((c) => !q || c.capability.includes(q))
            : [];
        return { capabilities: rows.slice(0, 400), mcp };
    }
    discover(p, projectId) {
        this.reader(p);
        this.project(p, projectId);
        return { projectId, capabilities: this.i.gateway.discover(projectId) };
    }
    events(p, params) {
        this.reader(p);
        const projectId = params.get("projectId") ?? undefined;
        this.project(p, projectId);
        const rows = this.i.events
            .list({
            ...(params.get("provider")
                ? { provider: params.get("provider") }
                : {}),
            ...(projectId ? { projectId } : {}),
            ...(params.get("type") ? { type: params.get("type") } : {}),
            ...(params.get("status") ? { status: params.get("status") } : {}),
            ...(params.get("since") ? { since: params.get("since") } : {}),
            limit: Number(params.get("limit") ?? "100") || 100,
        })
            .filter((e) => this.seen(p, e.projectId));
        return {
            events: rows,
            subscriptions: this.i.events
                .subscriptions()
                .filter((s) => this.seen(p, s.projectId)),
        };
    }
    activity(p, params) {
        this.reader(p);
        const projectId = params.get("projectId") ?? undefined;
        this.project(p, projectId);
        return {
            activity: this.i.gateway
                .activityLog({
                ...(projectId ? { projectId } : {}),
                ...(params.get("connectorId")
                    ? { connectorId: params.get("connectorId") }
                    : {}),
                ...(params.get("outcome") ? { outcome: params.get("outcome") } : {}),
                limit: Number(params.get("limit") ?? "100") || 100,
            })
                .filter((a) => this.seen(p, a.projectId)),
        };
    }
    health(p) {
        this.reader(p);
        return {
            connectors: this.i.registry
                .list()
                .map((c) => ({
                connectorId: c.connectorId,
                name: c.name,
                status: c.status,
                trust: c.trust,
                mode: c.mode,
                enabled: c.enabled,
                health: c.health,
            })),
            queue: this.i.gateway
                .queued()
                .slice(0, 50)
                .map((q) => ({
                id: q.id,
                capability: q.capability,
                connectorId: q.connectorId,
                projectId: q.request.projectId,
                status: q.status,
                attempts: q.attempts,
                nextAttemptAt: q.nextAttemptAt,
                lastError: q.lastError ?? null,
            }))
                .filter((q) => this.seen(p, q.projectId)),
            generatedAt: this.clock(),
        };
    }
    mcp(p) {
        this.reader(p);
        return {
            servers: this.i.mcp
                .list()
                .map((s) => ({
                ...s,
                config: { transport: s.config.transport, url: s.config.url ?? null },
            })),
        };
    }
    credentials(p) {
        this.reader(p);
        return {
            canStore: this.i.vault.canStore,
            credentials: this.i.vault
                .list()
                .map((x) => ({
                ref: x.ref,
                connectorId: x.connectorId,
                kind: x.kind,
                createdAt: x.createdAt,
                updatedAt: x.updatedAt,
                expiresAt: x.expiresAt,
            })),
            note: "Only metadata is ever shown. Values cannot be read back.",
        };
    }
    /** Integration audit trail: tool, integration, webhook and credential events from the governance ledger. */
    audit(p, params) {
        this.reader(p);
        const projectId = params.get("projectId") ?? undefined;
        this.project(p, projectId);
        const prefixes = [
            "tool.",
            "integration.",
            "webhook.",
            "credential.",
            "model.",
        ];
        const rows = this.s.ledger
            .query({
            ...(projectId ? { projectId } : {}),
            ...(params.get("result") ? { result: params.get("result") } : {}),
            limit: 500,
        })
            .filter((e) => prefixes.some((x) => e.operation.startsWith(x)) &&
            this.seen(p, e.projectId))
            .slice(0, Number(params.get("limit") ?? "100") || 100);
        return {
            entries: rows.map((e) => ({
                seq: e.seq,
                at: e.at,
                operation: e.operation,
                actor: e.actor,
                agentId: e.agentId ?? null,
                projectId: e.projectId ?? null,
                toolId: e.toolId ?? null,
                resource: e.resource ?? null,
                risk: e.risk ?? null,
                result: e.result,
                detail: e.detail,
            })),
        };
    }
    mappings(p, projectId) {
        this.reader(p);
        this.project(p, projectId);
        return {
            mappings: this.i.registry
                .mappings_()
                .filter((m) => this.seen(p, m.projectId) &&
                (!projectId || m.projectId === projectId)),
        };
    }
    /** Public signed-webhook entry point. Authentication is the HMAC signature, checked by the event hub. */
    receiveWebhook(connectorId, headers, raw) {
        return this.i.events.receive(connectorId, headers, raw);
    }
    /* --------------------------- commands -------------------------- */
    async execute(command, principal, body, options) {
        const correlationId = resolveCorrelationId(options);
        const resourceId = typeof body?.["connectorId"] === "string"
            ? body["connectorId"]
            : typeof body?.["projectId"] === "string"
                ? body["projectId"]
                : undefined;
        try {
            if (!INTEGRATION_COMMANDS.includes(command))
                throw new NotFoundError(`unknown command: ${command}`);
            if (!operatorCan(principal, "manage_integrations"))
                throw new PermissionDeniedError(`role "${principal.role}" may not manage integrations`);
            const details = await this.run(command, principal, body ?? {});
            return this.result(principal, command, "executed", undefined, "ok", resourceId, correlationId, details);
        }
        catch (error) {
            const { outcome, kind } = classify(error);
            return this.result(principal, command, outcome, kind, errorText(error), resourceId, correlationId, {});
        }
    }
    admin(p, what) {
        if (p.role !== "admin")
            throw new PermissionDeniedError(`only an administrator may ${what}`);
    }
    async run(command, p, b) {
        const i = this.i;
        const s = this.s;
        const led = (op, detail, result = "OK", severity) => s.ledger.record(op, {
            actor: p.id,
            ...(severity ? { severity } : {}),
            result,
            detail: detail,
        });
        switch (command) {
            case "integration_register_connector": {
                const id = str(b["connectorId"], "connectorId");
                const c = i.registry.install(id, p.id);
                led("integration.registered", { connectorId: id });
                return { connectorId: c.connectorId, status: c.status };
            }
            case "integration_configure": {
                const id = str(b["connectorId"], "connectorId");
                const settings = b["settings"] && typeof b["settings"] === "object"
                    ? Object.fromEntries(Object.entries(b["settings"]).filter(([, v]) => typeof v === "string"))
                    : undefined;
                const c = i.registry.configure(id, {
                    ...(typeof b["baseUrl"] === "string"
                        ? { baseUrl: b["baseUrl"] }
                        : {}),
                    ...(one(b["environment"], GOV_ENVIRONMENTS, "environment", false)
                        ? {
                            environment: one(b["environment"], GOV_ENVIRONMENTS, "environment", false),
                        }
                        : {}),
                    ...(settings ? { settings } : {}),
                }, p.id);
                led("integration.configured", { connectorId: id });
                return { connectorId: id, status: c.status };
            }
            case "integration_store_credential": {
                this.admin(p, "store credentials");
                const id = str(b["connectorId"], "connectorId");
                i.registry.require(id);
                const purpose = one(b["purpose"], ["primary", "webhook"], "purpose", false) ?? "primary";
                const kind = purpose === "webhook"
                    ? "webhook_secret"
                    : (one(b["kind"], ["api_key", "token", "basic"], "kind", false) ?? "token");
                const value = str(b["value"], "value", true, 20_000);
                // An OAuth connector reads a structured token record; a pasted access token is wrapped as one (it cannot be refreshed).
                const wrap = purpose === "primary" &&
                    i.registry.manifest(id)?.authMethod === "oauth2";
                const meta = i.vault.store({
                    ref: CredentialVault.refFor(id, purpose),
                    connectorId: id,
                    kind: wrap ? "oauth2" : kind,
                    value: wrap
                        ? JSON.stringify({
                            access_token: value,
                            refresh_token: null,
                            expires_at: null,
                        })
                        : value,
                    by: p.id,
                });
                if (purpose === "primary")
                    i.registry.markCredential(id, true, p.id);
                led("credential.stored", { connectorId: id, purpose, kind }, "STORED", "HIGH");
                return {
                    connectorId: id,
                    purpose,
                    kind: meta.kind,
                    storedAt: meta.updatedAt,
                };
            }
            case "integration_revoke_credential": {
                this.admin(p, "revoke credentials");
                const id = str(b["connectorId"], "connectorId");
                const m = i.registry.manifest(id);
                const purpose = one(b["purpose"], ["primary", "webhook"], "purpose", false) ?? "primary";
                let providerRevoked = false;
                if (purpose === "primary") {
                    if (m?.authMethod === "oauth2")
                        providerRevoked = (await i.oauth.revoke(id, m.oauth))
                            .revokedAtProvider;
                    else
                        i.vault.revoke(CredentialVault.refFor(id, "primary"));
                    i.registry.markCredential(id, false, p.id);
                }
                else
                    i.vault.revoke(EventHub.webhookRef(id));
                led("credential.revoked", { connectorId: id, purpose, providerRevoked }, "REVOKED", "HIGH");
                return { connectorId: id, purpose, providerRevoked };
            }
            case "integration_oauth_begin": {
                this.admin(p, "connect an account");
                const id = str(b["connectorId"], "connectorId");
                const m = i.registry.manifest(id);
                if (!m?.oauth)
                    throw new StateTransitionError("this connector does not use OAuth");
                const redirectUri = str(b["redirectUri"], "redirectUri");
                const r = i.oauth.begin(id, m.oauth, redirectUri, p.id);
                led("integration.oauth_started", { connectorId: id });
                return {
                    connectorId: id,
                    authorizeUrl: r.authorizeUrl,
                    expiresAt: r.expiresAt,
                };
            }
            case "integration_oauth_complete": {
                this.admin(p, "connect an account");
                const state = str(b["state"], "state");
                const code = str(b["code"], "code");
                const connectorId = str(b["connectorId"], "connectorId");
                const m = i.registry.manifest(connectorId);
                if (!m?.oauth)
                    throw new StateTransitionError("this connector does not use OAuth");
                const done = await i.oauth.complete(state, code, m.oauth, p.id);
                if (done.connectorId !== connectorId)
                    throw new ValidationError("the OAuth state belongs to a different connector");
                i.registry.markCredential(connectorId, true, p.id, done.expiresAt);
                led("credential.refreshed", { connectorId, via: "oauth" }, "CONNECTED", "HIGH");
                return {
                    connectorId,
                    connected: true,
                    expiresAt: done.expiresAt ?? null,
                };
            }
            case "integration_test_connection": {
                const id = str(b["connectorId"], "connectorId");
                const r = await i.gateway.testConnection(id, p.id);
                return {
                    connectorId: id,
                    ok: r.ok,
                    message: r.message,
                    latencyMs: r.latencyMs,
                };
            }
            case "integration_validate_security": {
                const id = str(b["connectorId"], "connectorId");
                const r = i.registry.runSecurityValidation(id);
                return { connectorId: id, ok: r.ok, checks: r.checks };
            }
            case "integration_enable": {
                this.admin(p, "enable a connector");
                const id = str(b["connectorId"], "connectorId");
                const c = i.registry.enable(id, p.id);
                led("integration.connected", { connectorId: id, status: c.status }, "ENABLED", "HIGH");
                return { connectorId: id, status: c.status };
            }
            case "integration_disable": {
                const id = str(b["connectorId"], "connectorId");
                const c = i.registry.disable(id, p.id);
                led("integration.disabled", { connectorId: id }, "DISABLED");
                return { connectorId: id, status: c.status };
            }
            case "integration_disconnect": {
                this.admin(p, "disconnect an integration");
                const id = str(b["connectorId"], "connectorId");
                const m = i.registry.manifest(id);
                if (m?.authMethod === "oauth2")
                    await i.oauth.revoke(id, m.oauth);
                else
                    i.vault.revoke(CredentialVault.refFor(id, "primary"));
                i.registry.markCredential(id, false, p.id);
                const c = i.registry.disable(id, p.id);
                led("integration.disconnected", { connectorId: id }, "DISCONNECTED", "HIGH");
                return { connectorId: id, status: c.status };
            }
            case "integration_set_mode": {
                const id = str(b["connectorId"], "connectorId");
                const mode = one(b["mode"], ["SANDBOX", "LIVE"], "mode");
                if (mode === "LIVE")
                    this.admin(p, "switch a connector to live mode");
                const c = i.registry.setMode(id, mode, p.id);
                led("integration.mode_changed", { connectorId: id, mode }, mode, "HIGH");
                return { connectorId: id, mode: c.mode };
            }
            case "integration_set_trust": {
                const id = str(b["connectorId"], "connectorId");
                const trust = one(b["trust"], TRUST_STATES, "trust");
                const cur = i.registry.require(id).trust;
                if (TRUST_RANK[trust] > TRUST_RANK[cur])
                    this.admin(p, "raise a connector's trust");
                const c = i.registry.setTrust(id, trust, p.id);
                led("integration.trust_changed", { connectorId: id, trust }, trust, "HIGH");
                return { connectorId: id, trust: c.trust };
            }
            case "integration_upgrade": {
                this.admin(p, "upgrade a connector");
                const id = str(b["connectorId"], "connectorId");
                const next = this.deps.upgradeFor?.(id);
                const cur = i.registry.manifest(id);
                if (!next || !cur || next.version === cur.version)
                    throw new StateTransitionError("this connector is already at the latest version");
                const r = i.registry.upgrade(id, next, p.id, b["acknowledgeBreaking"] === true);
                led("integration.upgraded", {
                    connectorId: id,
                    version: next.version,
                    breaking: r.breaking.length,
                }, "UPGRADED", "HIGH");
                return {
                    connectorId: id,
                    version: r.record.version,
                    breaking: r.breaking,
                };
            }
            case "integration_map_project": {
                const projectId = str(b["projectId"], "projectId");
                this.project(p, projectId);
                if (!this.deps.projectExists(projectId))
                    throw new NotFoundError("project not found");
                const m = i.registry.map({
                    projectId,
                    connectorId: str(b["connectorId"], "connectorId"),
                    resource: str(b["resource"], "resource"),
                    ...(one(b["environment"], GOV_ENVIRONMENTS, "environment", false)
                        ? {
                            environment: one(b["environment"], GOV_ENVIRONMENTS, "environment", false),
                        }
                        : {}),
                    ...(b["role"] === "FALLBACK" ? { role: "FALLBACK" } : {}),
                    source: "user",
                    by: p.id,
                });
                led("integration.mapped", {
                    connectorId: m.connectorId,
                    projectId,
                    role: m.role,
                });
                return { mappingId: m.id, projectId, connectorId: m.connectorId };
            }
            case "integration_unmap_project": {
                const mappingId = str(b["mappingId"], "mappingId");
                const m = i.registry.mappings_().find((x) => x.id === mappingId);
                if (!m)
                    throw new NotFoundError("mapping not found");
                this.project(p, m.projectId);
                i.registry.unmap(mappingId);
                led("integration.unmapped", {
                    connectorId: m.connectorId,
                    projectId: m.projectId,
                });
                return { mappingId, projectId: m.projectId };
            }
            case "integration_register_mcp": {
                this.admin(p, "register an MCP server");
                const policies = {};
                if (b["readOnlyTools"] && Array.isArray(b["readOnlyTools"]))
                    for (const t of b["readOnlyTools"])
                        if (typeof t === "string")
                            policies[t] = { operation: "READ" };
                const rec = i.mcp.register({
                    serverId: str(b["serverId"], "serverId"),
                    name: str(b["name"], "name"),
                    provider: str(b["provider"], "provider", false) ?? "MCP",
                    version: str(b["version"], "version", false) ?? "0",
                    ...(typeof b["url"] === "string" ? { url: b["url"] } : {}),
                    permissions: Array.isArray(b["permissions"])
                        ? b["permissions"].filter((x) => typeof x === "string")
                        : [],
                    projects: Array.isArray(b["projects"])
                        ? b["projects"].filter((x) => typeof x === "string")
                        : [],
                    toolPolicies: policies,
                    by: p.id,
                });
                led("integration.mcp_registered", { serverId: rec.serverId }, "PENDING_REVIEW", "HIGH");
                return { serverId: rec.serverId, status: rec.status };
            }
            case "integration_set_mcp_status": {
                this.admin(p, "change an MCP server's status");
                const status = one(b["status"], ["ENABLED", "DISABLED", "PENDING_REVIEW"], "status");
                const trust = one(b["trust"], TRUST_STATES, "trust", false);
                const rec = i.mcp.setStatus(str(b["serverId"], "serverId"), status, trust, p.id);
                led("integration.mcp_status", { serverId: rec.serverId, status }, status, "HIGH");
                return { serverId: rec.serverId, status: rec.status, trust: rec.trust };
            }
            case "integration_discover_mcp": {
                const rec = await i.mcp.discover(str(b["serverId"], "serverId"));
                return { serverId: rec.serverId, tools: rec.tools.length };
            }
            case "integration_create_subscription": {
                const projectId = str(b["projectId"], "projectId");
                this.project(p, projectId);
                if (!this.deps.projectExists(projectId))
                    throw new NotFoundError("project not found");
                const conditions = Array.isArray(b["conditions"])
                    ? b["conditions"]
                        .filter((c) => typeof c.field === "string" &&
                        (typeof c.equals === "string" ||
                            typeof c.equals === "number" ||
                            typeof c.equals === "boolean"))
                        .map((c) => ({
                        field: c.field,
                        equals: c.equals,
                    }))
                    : [];
                const sub = i.events.subscribe({
                    name: str(b["name"], "name"),
                    provider: str(b["provider"], "provider"),
                    eventType: str(b["eventType"], "eventType"),
                    projectId,
                    ...(typeof b["resourcePattern"] === "string"
                        ? { resourcePattern: b["resourcePattern"] }
                        : {}),
                    conditions,
                    request: str(b["request"], "request"),
                    by: p.id,
                });
                led("integration.subscription_created", {
                    subscriptionId: sub.subscriptionId,
                    projectId,
                });
                return { subscriptionId: sub.subscriptionId, projectId };
            }
            case "integration_set_subscription": {
                const subId = str(b["subscriptionId"], "subscriptionId");
                const sub = i.events
                    .subscriptions()
                    .find((x) => x.subscriptionId === subId);
                if (!sub)
                    throw new NotFoundError("subscription not found");
                this.project(p, sub.projectId);
                i.events.setEnabled(subId, b["enabled"] === true);
                return {
                    subscriptionId: subId,
                    enabled: b["enabled"] === true,
                    projectId: sub.projectId,
                };
            }
            case "integration_drain_queue": {
                const r = await i.gateway.drainQueue(10);
                return { ...r };
            }
            case "integration_simulate": {
                const projectId = str(b["projectId"], "projectId");
                this.project(p, projectId);
                const r = await i.gateway.invoke({
                    capability: str(b["capability"], "capability"),
                    projectId,
                    ...(typeof b["agentId"] === "string"
                        ? { agentId: b["agentId"] }
                        : { principalId: p.id }),
                    ...(typeof b["taskType"] === "string"
                        ? { taskType: b["taskType"] }
                        : {}),
                    ...(typeof b["resource"] === "string"
                        ? { resource: b["resource"] }
                        : {}),
                    parameters: b["parameters"] &&
                        typeof b["parameters"] === "object" &&
                        !Array.isArray(b["parameters"])
                        ? b["parameters"]
                        : {},
                    dryRun: true,
                });
                return {
                    projectId,
                    success: r.success,
                    connectorId: r.connectorId ?? null,
                    decision: r.decision ?? null,
                    error: r.error ?? null,
                    selection: r.metadata.selection ?? [],
                    executed: false,
                };
            }
        }
        throw new NotFoundError(`unknown command: ${command}`);
    }
    result(principal, command, outcome, errorKind, reason, resourceId, correlationId, details) {
        const event = this.deps.audit.record("control_command", {
            projectId: typeof details["projectId"] === "string"
                ? details["projectId"]
                : undefined,
            data: {
                ...redact(details),
                command,
                outcome,
                errorKind,
                correlationId,
                actor: principal?.id ?? "unknown",
                actorRole: principal?.role ?? "unknown",
                resourceId,
                reason,
            },
        });
        return {
            command,
            outcome,
            ok: outcome === "executed",
            errorKind,
            reason,
            resourceId,
            correlationId,
            details: redact(details),
            auditEventId: event.id,
            timestamp: this.clock(),
        };
    }
}
const TRUST_RANK = {
    DISABLED: 0,
    SUSPENDED: 0,
    REVIEW_REQUIRED: 1,
    LIMITED: 2,
    TRUSTED: 3,
};
void OPERATION_CLASSES;
function classify(error) {
    if (error instanceof PermissionDeniedError)
        return { outcome: "denied", kind: "forbidden" };
    if (error instanceof HubError) {
        if (error.code === "forbidden")
            return { outcome: "denied", kind: "forbidden" };
        if (error.code === "not_found")
            return { outcome: "rejected", kind: "not_found" };
        if (error.code === "invalid_state")
            return { outcome: "rejected", kind: "invalid_state" };
        return { outcome: "rejected", kind: "invalid_request" };
    }
    if (error instanceof VaultError)
        return {
            outcome: "rejected",
            kind: error.code === "no_key" || error.code === "expired"
                ? "invalid_state"
                : "invalid_request",
        };
    if (error instanceof NotFoundError)
        return { outcome: "rejected", kind: "not_found" };
    if (error instanceof StateTransitionError)
        return { outcome: "rejected", kind: "invalid_state" };
    if (error instanceof ValidationError)
        return { outcome: "rejected", kind: "invalid_request" };
    return { outcome: "rejected", kind: "command_failure" };
}
function errorText(error) {
    if (error instanceof PermissionDeniedError ||
        error instanceof NotFoundError ||
        error instanceof StateTransitionError ||
        error instanceof ValidationError ||
        error instanceof HubError ||
        error instanceof VaultError)
        return error.message;
    return "the command failed";
}
