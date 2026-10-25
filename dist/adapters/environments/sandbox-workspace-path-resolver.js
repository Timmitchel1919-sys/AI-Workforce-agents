export class SandboxWorkspacePathResolver {
    lookup;
    constructor(lookup) {
        this.lookup = lookup;
    }
    async resolve(workspaceId, projectId) {
        try {
            return this.lookup.workspaceRoot(workspaceId, projectId);
        }
        catch {
            return null;
        }
    }
}
