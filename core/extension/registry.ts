
export class ExtensionRegistry {
    private extensions = new Map<string, any>();
    register(manifest: any) {
        this.extensions.set(manifest.id, manifest);
    }
    get(id: string) {
        return this.extensions.get(id);
    }
}
