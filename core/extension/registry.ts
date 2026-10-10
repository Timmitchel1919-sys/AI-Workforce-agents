export interface ExtensionManifest {
  id: string;
  [key: string]: unknown;
}

export class ExtensionRegistry {
  private extensions = new Map<string, ExtensionManifest>();
  register(manifest: ExtensionManifest) {
    this.extensions.set(manifest.id, manifest);
  }
  get(id: string) {
    return this.extensions.get(id);
  }
}
