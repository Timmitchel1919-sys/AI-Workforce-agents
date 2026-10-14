/**
 * Tool Credential Broker.
 * Enables AI agents to use external credentials (GitHub tokens, API keys, service accounts)
 * inside tool invocations without ever exposing the credential string to the LLM context or prompt.
 */
export class ToolCredentialBroker {
    secretAccess;
    constructor(secretAccess) {
        this.secretAccess = secretAccess;
    }
    async executeWithSecret(context, reference, fn) {
        const caller = { id: context.principalId, type: context.principalType };
        const lease = await this.secretAccess.resolve(caller, reference.id, context);
        try {
            return await fn(lease.value);
        }
        finally {
            lease.dispose();
        }
    }
}
