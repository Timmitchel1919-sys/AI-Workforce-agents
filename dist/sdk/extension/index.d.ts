import { ExtensionManifest } from "../../contracts/extension.js";
export declare class ExtensionSDK {
    private manifest;
    constructor(manifest: ExtensionManifest);
    getCapabilities(): string[];
}
