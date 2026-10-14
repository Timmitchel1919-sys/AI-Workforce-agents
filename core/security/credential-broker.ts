import type {
  CredentialBroker,
  ManagedSecretReference,
  SecretAccessContext,
} from "../../contracts/index.js";
import type { SecretAccessService } from "./secret-access-service.js";

/**
 * Tool Credential Broker.
 * Enables AI agents to use external credentials (GitHub tokens, API keys, service accounts)
 * inside tool invocations without ever exposing the credential string to the LLM context or prompt.
 */
export class ToolCredentialBroker implements CredentialBroker {
  constructor(private readonly secretAccess: SecretAccessService) {}

  async executeWithSecret<T>(
    context: SecretAccessContext,
    reference: ManagedSecretReference,
    fn: (secretValue: string) => Promise<T>,
  ): Promise<T> {
    const caller = { id: context.principalId, type: context.principalType };
    const lease = await this.secretAccess.resolve(
      caller,
      reference.id,
      context,
    );
    try {
      return await fn(lease.value);
    } finally {
      lease.dispose();
    }
  }
}
