/**
 * Model provider adapter boundary.
 *
 * The core Workforce never imports a vendor SDK. Concrete providers (OpenAI,
 * Anthropic, Google, ...) implement `ModelProvider` and are injected at wiring
 * time. `EchoModelProvider` is a deterministic in-process double used by tests
 * and local wiring — it performs no network I/O.
 */
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../../contracts/index.js";

export type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelMessage,
} from "../../contracts/index.js";

export class EchoModelProvider implements ModelProvider {
  readonly id: string;

  constructor(id = "echo") {
    this.id = id;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const last = request.messages.at(-1);
    const content = last ? `echo: ${last.content}` : "echo: <empty>";
    return {
      content,
      model: request.model ?? "echo-1",
      usage: {
        inputTokens: request.messages.reduce(
          (total, message) => total + message.content.length,
          0,
        ),
        outputTokens: content.length,
      },
    };
  }
}
