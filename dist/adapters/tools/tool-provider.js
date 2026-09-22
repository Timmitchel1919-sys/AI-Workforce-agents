export class InMemoryToolProvider {
    id;
    handlers;
    constructor(id, handlers) {
        this.id = id;
        this.handlers = new Map(Object.entries(handlers));
    }
    get tools() {
        return [...this.handlers.keys()];
    }
    async execute(request) {
        const handler = this.handlers.get(request.tool);
        if (!handler) {
            throw new Error(`tool not registered on provider ${this.id}: ${request.tool}`);
        }
        const output = await handler(request.input, request);
        return { output };
    }
}
