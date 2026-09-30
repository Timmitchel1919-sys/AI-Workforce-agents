export interface ExtensionManifest {
    id: string;
    version: string;
    name: string;
    capabilities: string[];
    dependencies: Record<string, string>;
    permissions: string[];
}
export interface ExtensionContext {
    manifest: ExtensionManifest;
    runtime: any;
}
