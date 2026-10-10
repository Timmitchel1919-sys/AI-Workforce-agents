import type { ExtensionManifest } from "./registry.js";
export declare class ExtensionSandbox {
    create(manifest: ExtensionManifest): {
        isolated: boolean;
        manifestId: string;
    };
}
