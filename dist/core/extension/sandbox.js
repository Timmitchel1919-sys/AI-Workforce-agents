export class ExtensionSandbox {
    create(manifest) {
        return { isolated: true, manifestId: manifest.id };
    }
}
