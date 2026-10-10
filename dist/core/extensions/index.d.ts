interface ExtensionRecord {
    extensionId?: string;
    installationId?: string;
    status?: string;
    organizationId?: string;
}
export declare class ExtensionRegistry {
    private readonly installations;
    publishExtension(_data: Record<string, unknown>): ExtensionRecord & {
        extensionId: string;
    };
    listAvailableExtensions(): Array<ExtensionRecord & {
        extensionId: string;
    }>;
    installExtension(org: string, _ext: string, _usr: string, _caps: string[]): ExtensionRecord & {
        installationId: string;
    };
    listInstallations(org: string): ExtensionRecord[];
    uninstallExtension(inst: string): void;
}
export {};
