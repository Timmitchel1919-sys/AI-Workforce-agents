export class ExtensionSandbox {
  create(manifest: any) {
    return { isolated: true, manifestId: manifest.id };
  }
}
