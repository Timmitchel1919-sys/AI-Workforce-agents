import type { CredentialBroker, ManagedSecretReference, SecretAccessContext } from "../../contracts/index.js";
import type { SecretAccessService } from "./secret-access-service.js";
/**
 * Tool Credential Broker.
 * Enables AI agents to use external credentials (GitHub tokens, API keys, service accounts)
 * inside tool invocations without ever exposing the credential string to the LLM context or prompt.
 */
export declare class ToolCredentialBroker implements CredentialBroker {
    private readonly secretAccess;
    constructor(secretAccess: SecretAccessService);
    executeWithSecret<T>(context: SecretAccessContext, reference: ManagedSecretReference, fn: (secretValue: string) => Promise<T>): Promise<T>;
}
