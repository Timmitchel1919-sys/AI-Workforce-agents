export class ExtensionSDK {
    manifest;
    constructor(manifest) {
        this.manifest = manifest;
    }
    getCapabilities() { return this.manifest.capabilities; }
}
