/**
 * IntegrationControlService — the Integration Center's governed read/command surface.
 *
 * Reads need `view` (project-bound data also needs project access). Commands need
 * `manage_integrations`; the consequential ones — storing a credential, going live,
 * raising trust, enabling a connector, registering an MCP server — are
 * administrator-only. A credential value travels in exactly one command body, goes
 * straight into the vault and is never echoed, audited or returned.
 */
import { type CommandOptions, type ControlCommandResult, type OperatorPrincipal } from "../../contracts/index.js";
import { type OperationClass } from "../../contracts/integration-gateway.js";
import { type TrustState } from "../../contracts/security-governance.js";
import { type ConnectorManifest, type IntegrationSystem, type SecuritySystem } from "../../core/index.js";
import type { AuditLog } from "../../core/index.js";
type Body = Record<string, unknown>;
export interface IntegrationControlDeps {
    integrations: IntegrationSystem;
    security: SecuritySystem;
    audit: AuditLog;
    projectExists: (projectId: string) => boolean;
    /** A newer manifest for a connector, if one is available (production ships only the built-in ones). */
    upgradeFor?: (connectorId: string) => ConnectorManifest | undefined;
    redirectBase?: string;
    clock?: () => string;
}
export declare class IntegrationControlService {
    private readonly deps;
    private readonly clock;
    private readonly i;
    private readonly s;
    constructor(deps: IntegrationControlDeps);
    private reader;
    private project;
    private seen;
    private connectorView;
    overview(p: OperatorPrincipal, projectId?: string): {
        summary: {
            connectors: number;
            healthy: number;
            degraded: number;
            error: number;
            disconnected: number;
            disabled: number;
            waitingApproval: number;
            blocked24h: number;
            queued: number;
        };
        connectors: {
            connectorId: string;
            provider: string;
            name: string;
            description: string;
            kind: import("../../contracts/integration-gateway.js").ConnectorKind;
            family: string;
            version: string;
            providerApiVersion: string;
            status: "DISABLED" | "DEGRADED" | "DISCOVERED" | "CONFIGURED" | "CONNECTED" | "HEALTHY" | "DISCONNECTED" | "ERROR";
            trust: "TRUSTED" | "LIMITED" | "REVIEW_REQUIRED" | "SUSPENDED" | "DISABLED";
            mode: import("../../contracts/integration-gateway.js").ConnectorMode;
            enabled: boolean;
            auth: {
                method: import("../../contracts/integration-gateway.js").AuthMethod;
                scopes: string[];
                credentialConfigured: boolean;
                connectedAt: string | null;
                expiresAt: string | null;
                oauthAvailable: boolean;
            };
            config: {
                baseUrl: string | null;
                environment: "DEVELOPMENT" | "TEST" | "STAGING" | "PRODUCTION" | null;
                settings: Record<string, string>;
            };
            capabilities: {
                total: number;
                available: number;
                reads: number;
                sideEffects: number;
            };
            health: import("../../contracts/integration-gateway.js").HealthSnapshot;
            events: string[];
            environments: ("DEVELOPMENT" | "TEST" | "STAGING" | "PRODUCTION")[];
            costClass: "FREE" | "METERED";
            installation: import("../../contracts/integration-gateway.js").InstallStep[];
            projects: string[];
            lastActivity: {
                at: string;
                capability: string;
                outcome: "DENIED" | "FAILED" | "QUEUED" | "SUCCESS" | "WAITING_APPROVAL" | "BLOCKED" | "SIMULATED";
            } | null;
            updatedAt: string;
        }[];
        recentActivity: import("../../contracts/integration-gateway.js").ActivityRecord[];
        vault: {
            canStoreCredentials: boolean;
            note: string;
        };
        capabilities: {
            mcp: number;
            webhooks: boolean;
            oauthProviders: number;
        };
        generatedAt: string;
    };
    connector(p: OperatorPrincipal, id: string): {
        capabilityList: {
            capability: string;
            description: string;
            operation: "DRAFT" | "READ" | "PUBLISH" | "DEPLOY" | "DELETE" | "WRITE" | "SEND";
            risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
            version: number;
            permissions: string[];
            sandbox: string;
            approval: string;
            queueable: boolean;
            unavailable: string | null;
            params: import("../../contracts/integration-gateway.js").ParamSpec[];
        }[];
        mappings: import("../../contracts/integration-gateway.js").ProjectIntegrationMapping[];
        credentials: {
            ref: string;
            kind: "api_key" | "webhook_secret" | "oauth2" | "token" | "basic";
            createdAt: string;
            updatedAt: string;
            expiresAt: string | null;
        }[];
        webhook: {
            configured: boolean;
            endpoint: string;
        };
        activity: import("../../contracts/integration-gateway.js").ActivityRecord[];
        events: import("../../contracts/integration-gateway.js").HubEvent[];
        securityValidation: {
            ok: boolean;
            checks: {
                check: string;
                ok: boolean;
                detail: string;
            }[];
        };
        connectorId: string;
        provider: string;
        name: string;
        description: string;
        kind: import("../../contracts/integration-gateway.js").ConnectorKind;
        family: string;
        version: string;
        providerApiVersion: string;
        status: "DISABLED" | "DEGRADED" | "DISCOVERED" | "CONFIGURED" | "CONNECTED" | "HEALTHY" | "DISCONNECTED" | "ERROR";
        trust: "TRUSTED" | "LIMITED" | "REVIEW_REQUIRED" | "SUSPENDED" | "DISABLED";
        mode: import("../../contracts/integration-gateway.js").ConnectorMode;
        enabled: boolean;
        auth: {
            method: import("../../contracts/integration-gateway.js").AuthMethod;
            scopes: string[];
            credentialConfigured: boolean;
            connectedAt: string | null;
            expiresAt: string | null;
            oauthAvailable: boolean;
        };
        config: {
            baseUrl: string | null;
            environment: "DEVELOPMENT" | "TEST" | "STAGING" | "PRODUCTION" | null;
            settings: Record<string, string>;
        };
        capabilities: {
            total: number;
            available: number;
            reads: number;
            sideEffects: number;
        };
        health: import("../../contracts/integration-gateway.js").HealthSnapshot;
        environments: ("DEVELOPMENT" | "TEST" | "STAGING" | "PRODUCTION")[];
        costClass: "FREE" | "METERED";
        installation: import("../../contracts/integration-gateway.js").InstallStep[];
        projects: string[];
        lastActivity: {
            at: string;
            capability: string;
            outcome: "DENIED" | "FAILED" | "QUEUED" | "SUCCESS" | "WAITING_APPROVAL" | "BLOCKED" | "SIMULATED";
        } | null;
        updatedAt: string;
    };
    /** Tool Explorer: search capabilities across providers. */
    capabilities(p: OperatorPrincipal, params: URLSearchParams): {
        capabilities: {
            status: "DISABLED" | "DEGRADED" | "DISCOVERED" | "CONFIGURED" | "CONNECTED" | "HEALTHY" | "DISCONNECTED" | "ERROR";
            mode: import("../../contracts/integration-gateway.js").ConnectorMode;
            trust: "TRUSTED" | "LIMITED" | "REVIEW_REQUIRED" | "SUSPENDED" | "DISABLED";
            approval: string;
            mappedToProject: boolean | null;
            capability: string;
            description: string;
            operation: string;
            risk: string;
            connectorId: string;
            provider: string;
            family: string;
            unavailable?: string;
            permissions: string[];
            sandbox: unknown;
        }[];
        mcp: {
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
    };
    discover(p: OperatorPrincipal, projectId: string): {
        projectId: string;
        capabilities: {
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
            reason?: string;
        }[];
    };
    events(p: OperatorPrincipal, params: URLSearchParams): {
        events: import("../../contracts/integration-gateway.js").HubEvent[];
        subscriptions: import("../../contracts/integration-gateway.js").EventSubscription[];
    };
    activity(p: OperatorPrincipal, params: URLSearchParams): {
        activity: import("../../contracts/integration-gateway.js").ActivityRecord[];
    };
    health(p: OperatorPrincipal): {
        connectors: {
            connectorId: string;
            name: string;
            status: "DISABLED" | "DEGRADED" | "DISCOVERED" | "CONFIGURED" | "CONNECTED" | "HEALTHY" | "DISCONNECTED" | "ERROR";
            trust: "TRUSTED" | "LIMITED" | "REVIEW_REQUIRED" | "SUSPENDED" | "DISABLED";
            mode: import("../../contracts/integration-gateway.js").ConnectorMode;
            enabled: boolean;
            health: import("../../contracts/integration-gateway.js").HealthSnapshot;
        }[];
        queue: {
            id: string;
            capability: string;
            connectorId: string;
            projectId: string;
            status: "DONE" | "FAILED" | "QUEUED";
            attempts: number;
            nextAttemptAt: string;
            lastError: string | null;
        }[];
        generatedAt: string;
    };
    mcp(p: OperatorPrincipal): {
        servers: {
            config: {
                transport: "http" | "stdio";
                url: string | null;
            };
            serverId: string;
            name: string;
            provider: string;
            version: string;
            status: "ENABLED" | "DISABLED" | "PENDING_REVIEW";
            trust: TrustState;
            risk: import("../../contracts/security-governance.js").GovRisk;
            permissions: string[];
            projects: string[];
            toolPolicies: Record<string, {
                operation: OperationClass;
                risk?: import("../../contracts/security-governance.js").GovRisk;
            }>;
            tools: {
                name: string;
                description: string;
            }[];
            health: {
                status: import("../../contracts/integration-gateway.js").ConnectorState;
                checkedAt?: string;
                error?: string;
            };
            registeredBy: string;
            createdAt: string;
            updatedAt: string;
            id: string;
        }[];
    };
    credentials(p: OperatorPrincipal): {
        canStore: boolean;
        credentials: {
            ref: string;
            connectorId: string;
            kind: "api_key" | "webhook_secret" | "oauth2" | "token" | "basic";
            createdAt: string;
            updatedAt: string;
            expiresAt: string | null;
        }[];
        note: string;
    };
    /** Integration audit trail: tool, integration, webhook and credential events from the governance ledger. */
    audit(p: OperatorPrincipal, params: URLSearchParams): {
        entries: {
            seq: number;
            at: string;
            operation: string;
            actor: string;
            agentId: string | null;
            projectId: string | null;
            toolId: string | null;
            resource: string | null;
            risk: string | null;
            result: string;
            detail: Record<string, string | number | boolean>;
        }[];
    };
    mappings(p: OperatorPrincipal, projectId?: string): {
        mappings: import("../../contracts/integration-gateway.js").ProjectIntegrationMapping[];
    };
    /** Public signed-webhook entry point. Authentication is the HMAC signature, checked by the event hub. */
    receiveWebhook(connectorId: string, headers: Record<string, string | string[] | undefined>, raw: string): Promise<{
        status: number;
        body: Record<string, unknown>;
    }>;
    execute(command: string, principal: OperatorPrincipal, body: Body, options?: CommandOptions): Promise<ControlCommandResult>;
    private admin;
    private run;
    private result;
}
export {};
