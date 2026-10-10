export class ExtensionRegistry {
    extensions = new Map();
    register(manifest) {
        this.extensions.set(manifest.id, manifest);
    }
    get(id) {
        return this.extensions.get(id);
    }
}
