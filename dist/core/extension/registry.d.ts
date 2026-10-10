export interface ExtensionManifest {
    id: string;
    [key: string]: unknown;
}
export declare class ExtensionRegistry {
    private extensions;
    register(manifest: ExtensionManifest): void;
    get(id: string): ExtensionManifest | undefined;
}
