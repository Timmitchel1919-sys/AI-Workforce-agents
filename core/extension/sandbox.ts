import type { ExtensionManifest } from "./registry.js";

export class ExtensionSandbox {
  create(manifest: ExtensionManifest) {
    return { isolated: true, manifestId: manifest.id };
  }
}
