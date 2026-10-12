/**
 * MCP gateway and server registry.
 *
 * An MCP server is NOT a trust boundary. A server must be registered by the user, enabled,
 * and explicitly allowed for the project; every tool it offers becomes the capability
 * `mcp.<serverId>.<tool>` and goes through exactly the same governance, approval, audit
 * and rate pipeline as any connector. Tools default to a side-effecting classification
 * unless the user marks them read-only when registering the server.
 */
import type { Repository } from "../../contracts/persistence.js";
import type { FailureKind, McpServerRecord, OperationClass } from "../../contracts/integration-gateway.js";
import type { GovRisk, TrustState } from "../../contracts/security-governance.js";
import { type FetchLike } from "./rest.js";
export interface McpTransport {
    listTools(server: McpServerRecord): Promise<{
        name: string;
        description: string;
    }[]>;
    callTool(server: McpServerRecord, tool: string, args: Record<string, unknown>): Promise<unknown>;
}
/** JSON-RPC 2.0 over HTTP POST. Only the registered https URL is ever contacted. */
export declare class HttpMcpTransport implements McpTransport {
    private readonly fetchImpl;
    private readonly credentialHeader?;
    constructor(fetchImpl: FetchLike, credentialHeader?: ((server: McpServerRecord) => Promise<Record<string, string>>) | undefined);
    private rpc;
    listTools(server: McpServerRecord): Promise<{
        name: string;
        description: string;
    }[]>;
    callTool(server: McpServerRecord, tool: string, args: Record<string, unknown>): Promise<unknown>;
}
export type McpResolution = {
    ok: true;
    server: McpServerRecord;
    tool: string;
    operation: OperationClass;
    risk: GovRisk;
} | {
    ok: false;
    reason: string;
};
export declare class McpGateway {
    private readonly transport;
    private readonly clock;
    private readonly repo;
    constructor(repo: Repository<McpServerRecord>, transport: McpTransport | undefined, clock: () => string);
    list(): McpServerRecord[];
    get(serverId: string): McpServerRecord | undefined;
    register(input: {
        serverId: string;
        name: string;
        provider: string;
        version: string;
        url?: string;
        permissions?: string[];
        projects?: string[];
        risk?: GovRisk;
        toolPolicies?: McpServerRecord["toolPolicies"];
        by: string;
    }): McpServerRecord;
    setStatus(serverId: string, status: McpServerRecord["status"], trust: TrustState | undefined, by: string): McpServerRecord;
    discover(serverId: string): Promise<McpServerRecord>;
    /** `mcp.<serverId>.<tool>` → the server, tool and its classification — or why it is blocked. */
    resolve(capability: string, projectId?: string): McpResolution;
    call(serverId: string, tool: string, args: Record<string, unknown>): Promise<{
        ok: boolean;
        data?: unknown;
        kind?: FailureKind;
        message?: string;
    }>;
    /** Capabilities visible to a project (only enabled servers it is allowed to use). */
    capabilities(projectId: string): {
        capability: string;
        description: string;
        operation: OperationClass;
        risk: string;
        providers: {
            connectorId: string;
            provider: string;
            status: string;
            mode: string;
            trust: string;
            resource: string;
            role: string;
        }[];
        approval: "none" | "likely" | "always";
        available: boolean;
    }[];
}
