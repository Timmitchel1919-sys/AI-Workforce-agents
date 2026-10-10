export declare class ExtensionRegistry {
    publishExtension(data: any): any;
    listAvailableExtensions(): any[];
    installExtension(org: string, ext: string, usr: string, caps: string[]): any;
    listInstallations(org: string): any[];
    uninstallExtension(inst: string): void;
}
