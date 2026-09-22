export class EchoModelProvider {
    id;
    constructor(id = "echo") {
        this.id = id;
    }
    async generate(request) {
        const last = request.messages.at(-1);
        const content = last ? `echo: ${last.content}` : "echo: <empty>";
        return {
            content,
            model: request.model ?? "echo-1",
            usage: {
                inputTokens: request.messages.reduce((total, message) => total + message.content.length, 0),
                outputTokens: content.length,
            },
        };
    }
}
