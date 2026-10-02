import { ExtensionDefinition, ExtensionInstallation } from "../../contracts/extensions.js";
export declare class ExtensionRegistry {
    private extensions;
    private installations;
    publishExtension(definition: Omit<ExtensionDefinition, "extensionId" | "status" | "createdAt">): ExtensionDefinition;
    installExtension(organizationId: string, extensionId: string, userId: string, scopes: string[]): ExtensionInstallation;
    listAvailableExtensions(): ExtensionDefinition[];
    listInstallations(organizationId: string): ExtensionInstallation[];
    uninstallExtension(installationId: string): void;
}
