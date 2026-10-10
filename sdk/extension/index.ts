import { ExtensionManifest } from "../../contracts/extension.js";
export class ExtensionSDK {
  constructor(private manifest: ExtensionManifest) {}
  getCapabilities() {
    return this.manifest.capabilities;
  }
}
