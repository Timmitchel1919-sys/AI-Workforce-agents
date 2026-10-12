import { SyncCache } from "../knowledge-memory/memory-service.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
import { hostAllowed, sanitize } from "./rest.js";
import { HubError } from "./registry.js";
/** JSON-RPC 2.0 over HTTP POST. Only the registered https URL is ever contacted. */
export class HttpMcpTransport {
    fetchImpl;
    credentialHeader;
    constructor(fetchImpl, credentialHeader) {
        this.fetchImpl = fetchImpl;
        this.credentialHeader = credentialHeader;
    }
    async rpc(server, method, params) {
        const url = server.config.url;
        if (server.config.transport !== "http" || !url)
            throw new Error("only the http transport is supported");
        const host = new URL(url).hostname;
        if (!hostAllowed(url, [host]))
            throw new Error("the MCP server URL must be https");
        const res = await this.fetchImpl(url, {
            method: "POST",
            redirect: "manual",
            headers: {
                "content-type": "application/json",
                accept: "application/json",
                ...((await this.credentialHeader?.(server)) ?? {}),
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        const text = await res.text();
        if (!res.ok)
            throw new Error(`MCP server answered ${res.status}`);
        const json = JSON.parse(text);
        if (json.error)
            throw new Error(String(json.error.message ?? "MCP error"));
        return json.result;
    }
    async listTools(server) {
        const r = (await this.rpc(server, "tools/list", {}));
        return (r?.tools ?? [])
            .slice(0, 200)
            .map((t) => ({
            name: String(t.name).slice(0, 100),
            description: String(t.description ?? "").slice(0, 300),
        }));
    }
    async callTool(server, tool, args) {
        return this.rpc(server, "tools/call", { name: tool, arguments: args });
    }
}
export class McpGateway {
    transport;
    clock;
    repo;
    constructor(repo, transport, clock) {
        this.transport = transport;
        this.clock = clock;
        this.repo = new SyncCache(repo);
    }
    list() {
        return this.repo.list().sort((a, b) => a.name.localeCompare(b.name));
    }
    get(serverId) {
        return this.repo.findById(serverId);
    }
    register(input) {
        if (!/^[a-z][a-z0-9-]{1,40}$/.test(input.serverId))
            throw new HubError("invalid_request", "serverId must be lowercase letters, digits and dashes");
        if (this.get(input.serverId))
            throw new HubError("invalid_state", "an MCP server with this id is already registered");
        if (input.url && !hostAllowed(input.url, [new URL(input.url).hostname]))
            throw new HubError("invalid_request", "the MCP server URL must be https");
        const now = this.clock();
        const record = {
            id: input.serverId,
            serverId: input.serverId,
            name: input.name.slice(0, 80),
            provider: input.provider.slice(0, 80),
            version: input.version.slice(0, 20),
            // A new server is reviewed before it can be used.
            status: "PENDING_REVIEW",
            trust: "REVIEW_REQUIRED",
            risk: input.risk ?? "HIGH",
            permissions: (input.permissions ?? []).slice(0, 20),
            projects: (input.projects ?? []).slice(0, 20),
            config: {
                transport: input.url ? "http" : "stdio",
                ...(input.url ? { url: input.url } : {}),
            },
            toolPolicies: input.toolPolicies ?? {},
            tools: [],
            health: { status: "DISCOVERED" },
            registeredBy: input.by,
            createdAt: now,
            updatedAt: now,
        };
        this.repo.upsert(record);
        return record;
    }
    setStatus(serverId, status, trust, by) {
        const s = this.get(serverId);
        if (!s)
            throw new HubError("not_found", "MCP server not found");
        const next = {
            ...s,
            status,
            ...(trust ? { trust } : {}),
            updatedAt: this.clock(),
        };
        void by;
        this.repo.upsert(next);
        return next;
    }
    async discover(serverId) {
        const s = this.get(serverId);
        if (!s)
            throw new HubError("not_found", "MCP server not found");
        if (!this.transport)
            throw new HubError("invalid_state", "no MCP transport is configured in this deployment");
        try {
            const tools = await this.transport.listTools(s);
            const next = {
                ...s,
                tools,
                health: { status: "HEALTHY", checkedAt: this.clock() },
                updatedAt: this.clock(),
            };
            this.repo.upsert(next);
            return next;
        }
        catch (error) {
            const next = {
                ...s,
                health: {
                    status: "ERROR",
                    checkedAt: this.clock(),
                    error: maskSecrets(error instanceof Error ? error.message : "failed").slice(0, 160),
                },
                updatedAt: this.clock(),
            };
            this.repo.upsert(next);
            throw new HubError("invalid_state", `could not list the server's tools: ${next.health.error}`);
        }
    }
    /** `mcp.<serverId>.<tool>` → the server, tool and its classification — or why it is blocked. */
    resolve(capability, projectId) {
        const m = /^mcp\.([a-z][a-z0-9-]{1,40})\.(.{1,100})$/.exec(capability);
        if (!m)
            return { ok: false, reason: "malformed MCP capability" };
        const server = this.get(m[1]);
        if (!server)
            return {
                ok: false,
                reason: `MCP server "${m[1]}" is not registered; unregistered servers are blocked`,
            };
        if (server.status !== "ENABLED")
            return {
                ok: false,
                reason: `MCP server "${server.name}" is ${server.status.toLowerCase().replace("_", " ")}`,
            };
        if (server.trust === "SUSPENDED" || server.trust === "DISABLED")
            return {
                ok: false,
                reason: `MCP server "${server.name}" trust is ${server.trust}`,
            };
        if (projectId && !server.projects.includes(projectId))
            return {
                ok: false,
                reason: `MCP server "${server.name}" is not allowed for project ${projectId}`,
            };
        const tool = m[2];
        const known = server.tools.some((t) => t.name === tool) || tool in server.toolPolicies;
        if (!known)
            return {
                ok: false,
                reason: `"${tool}" is not a known tool of "${server.name}"; discover its tools first`,
            };
        const policy = server.toolPolicies[tool];
        return {
            ok: true,
            server,
            tool,
            operation: policy?.operation ?? "WRITE",
            risk: policy?.risk ?? server.risk,
        };
    }
    async call(serverId, tool, args) {
        const server = this.get(serverId);
        if (!server || !this.transport)
            return {
                ok: false,
                kind: "PERMANENT",
                message: "the MCP server or transport is not available",
            };
        try {
            return {
                ok: true,
                data: sanitize(await this.transport.callTool(server, tool, args)),
            };
        }
        catch (error) {
            return {
                ok: false,
                kind: "PROVIDER_ERROR",
                message: maskSecrets(error instanceof Error ? error.message : "failed").slice(0, 200),
            };
        }
    }
    /** Capabilities visible to a project (only enabled servers it is allowed to use). */
    capabilities(projectId) {
        const rows = [];
        for (const s of this.list()) {
            if (s.status !== "ENABLED" || !s.projects.includes(projectId))
                continue;
            for (const t of s.tools) {
                const policy = s.toolPolicies[t.name];
                const operation = policy?.operation ?? "WRITE";
                rows.push({
                    capability: `mcp.${s.serverId}.${t.name}`,
                    description: t.description,
                    operation,
                    risk: policy?.risk ?? s.risk,
                    providers: [
                        {
                            connectorId: `mcp.${s.serverId}`,
                            provider: s.provider,
                            status: s.health.status,
                            mode: "LIVE",
                            trust: s.trust,
                            resource: "*",
                            role: "PRIMARY",
                        },
                    ],
                    approval: (operation === "READ" ? "none" : "always"),
                    available: s.health.status !== "ERROR",
                });
            }
        }
        return rows;
    }
}
