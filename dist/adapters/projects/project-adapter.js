export class BaseProjectAdapter {
    async describe() {
        return {
            name: this.displayName,
            capabilities: Object.values(this.operations).map((op) => op.capability),
        };
    }
    async execute(operation, input) {
        // Own properties only: "constructor"/"__proto__" must be "not exposed".
        const entry = Object.hasOwn(this.operations, operation)
            ? this.operations[operation]
            : undefined;
        if (!entry) {
            throw new Error(`operation not exposed by project adapter ${this.projectId}: ${operation}`);
        }
        return entry.handler(input);
    }
}
