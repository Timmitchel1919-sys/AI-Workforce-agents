export class BaseProjectAdapter {
    async describe() {
        return {
            name: this.displayName,
            capabilities: Object.values(this.operations).map((op) => op.capability),
        };
    }
    async execute(operation, input) {
        const entry = this.operations[operation];
        if (!entry) {
            throw new Error(`operation not exposed by project adapter ${this.projectId}: ${operation}`);
        }
        return entry.handler(input);
    }
}
