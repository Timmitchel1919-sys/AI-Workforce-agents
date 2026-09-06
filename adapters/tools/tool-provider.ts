/**
 * Tool provider adapter boundary.
 *
 * No unrestricted shell, filesystem, or credential access is provided here. A
 * concrete provider must expose only explicitly named, individually reviewed
 * tools. `InMemoryToolProvider` is a test/local double backed by an explicit
 * handler map.
 */
import type {
  ToolProvider,
  ToolRequest,
  ToolResponse,
} from "../../contracts/index.js";

export type {
  ToolProvider,
  ToolRequest,
  ToolResponse,
} from "../../contracts/index.js";

export type ToolHandler = (
  input: unknown,
  request: ToolRequest,
) => Promise<unknown> | unknown;

export class InMemoryToolProvider implements ToolProvider {
  readonly id: string;
  private readonly handlers: Map<string, ToolHandler>;

  constructor(id: string, handlers: Record<string, ToolHandler>) {
    this.id = id;
    this.handlers = new Map(Object.entries(handlers));
  }

  get tools(): readonly string[] {
    return [...this.handlers.keys()];
  }

  async execute(request: ToolRequest): Promise<ToolResponse> {
    const handler = this.handlers.get(request.tool);
    if (!handler) {
      throw new Error(
        `tool not registered on provider ${this.id}: ${request.tool}`,
      );
    }
    const output = await handler(request.input, request);
    return { output };
  }
}
