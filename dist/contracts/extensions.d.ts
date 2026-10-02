export interface ExtensionDefinition {
    extensionId: string;
    name: string;
    version: string;
    publisher: string;
    description: string;
    capabilities: ("READ_DATA" | "WRITE_DATA" | "EXECUTE_TASKS" | "INTERCEPT_EVENTS")[];
    manifestUrl: string;
    status: "PUBLISHED" | "DEPRECATED" | "UNPUBLISHED";
    createdAt: Date;
}
export interface ExtensionInstallation {
    installationId: string;
    organizationId: string;
    extensionId: string;
    installedBy: string;
    version: string;
    status: "ACTIVE" | "SUSPENDED" | "ERROR";
    grantedScopes: string[];
    installedAt: Date;
}
