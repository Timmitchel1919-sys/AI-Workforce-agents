/**
 * Connector registry: lifecycle, installation workflow, trust, mode, versioning and the
 * project ↔ integration ↔ resource mapping.
 *
 * Nothing becomes usable by accident: a connector starts DISCOVERED, in SANDBOX mode,
 * with LIMITED trust and disabled. Enabling it needs credentials, a passing connection
 * test and a passing security validation — and live mode is a separate administrator
 * decision. Configuration is separate from credentials, which live only in the vault.
 */
import type { Repository } from "../../contracts/persistence.js";
import { type ConnectorMode, type HubConnector, type InstallStep, type ProjectIntegrationMapping } from "../../contracts/integration-gateway.js";
import type { GovEnvironment, TrustState } from "../../contracts/security-governance.js";
import { type ConnectorManifest, type RestCapability } from "./rest.js";
import type { TrustRegistry } from "../security-governance/trust-registry.js";
export declare class HubError extends Error {
    readonly code: "not_found" | "invalid_request" | "invalid_state" | "forbidden";
    constructor(code: "not_found" | "invalid_request" | "invalid_state" | "forbidden", message: string);
}
export declare const hubToolId: (capability: string) => string;
export interface RegistryRepos {
    connectors: Repository<HubConnector>;
    mappings: Repository<ProjectIntegrationMapping>;
}
export declare class HubRegistry {
    private readonly clock;
    private readonly trust?;
    private readonly connectors;
    private readonly mappings;
    private readonly manifests;
    constructor(repos: RegistryRepos, clock: () => string, trust?: Pick<TrustRegistry, "setTool"> | undefined, manifests?: readonly ConnectorManifest[]);
    manifest(connectorId: string): ConnectorManifest | undefined;
    manifestsList(): ConnectorManifest[];
    registerManifest(m: ConnectorManifest): void;
    get(connectorId: string): HubConnector | undefined;
    require(connectorId: string): HubConnector;
    list(): HubConnector[];
    save(c: HubConnector): HubConnector;
    private emptyHealth;
    /** Create the record for a manifest (idempotent). Tool trust is registered for every capability. */
    install(connectorId: string, by: string): HubConnector;
    installAll(by: string): HubConnector[];
    private registerTools;
    capabilityOf(connectorId: string, capability: string): RestCapability | undefined;
    /** Connectors that implement a capability (provider abstraction). */
    providersFor(capability: string): {
        connector: HubConnector;
        cap: RestCapability;
    }[];
    allCapabilities(): {
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
    setStep(connectorId: string, step: InstallStep["step"], status: InstallStep["status"], note?: string): HubConnector;
    configure(connectorId: string, input: {
        baseUrl?: string;
        environment?: GovEnvironment;
        settings?: Record<string, string>;
    }, by: string): HubConnector;
    allowedHosts(connectorId: string): string[];
    /** Deterministic security validation. The result is recorded as the SECURITY_VALIDATION step. */
    validateSecurity(connectorId: string): {
        ok: boolean;
        checks: {
            check: string;
            ok: boolean;
            detail: string;
        }[];
    };
    runSecurityValidation(connectorId: string): {
        ok: boolean;
        checks: {
            check: string;
            ok: boolean;
            detail: string;
        }[];
    };
    enable(connectorId: string, by: string): HubConnector;
    disable(connectorId: string, by: string): HubConnector;
    setTrust(connectorId: string, trust: TrustState, by: string): HubConnector;
    setMode(connectorId: string, mode: ConnectorMode, by: string): HubConnector;
    /** Credential changes flow through here so status and the install step stay consistent. */
    markCredential(connectorId: string, configured: boolean, by: string, expiresAt?: string): HubConnector;
    /**
     * Replace the connector manifest by a newer version. Removing a capability, raising its risk or adding
     * side-effecting capabilities is breaking: the connector is disabled until validated again.
     */
    upgrade(connectorId: string, next: ConnectorManifest, by: string, acknowledged: boolean): {
        record: HubConnector;
        breaking: string[];
    };
    /** Derive the lifecycle state from facts (never stored independently of them). */
    recompute(c: HubConnector): HubConnector;
    mappings_(): ProjectIntegrationMapping[];
    mappingsFor(projectId: string): ProjectIntegrationMapping[];
    mappingFor(projectId: string, connectorId: string): ProjectIntegrationMapping[];
    map(input: {
        projectId: string;
        connectorId: string;
        resource: string;
        environment?: GovEnvironment;
        role?: "PRIMARY" | "FALLBACK";
        source: ProjectIntegrationMapping["source"];
        by: string;
    }): ProjectIntegrationMapping;
    unmap(mappingId: string): boolean;
}
