/**
 * Tool provider adapter boundary.
 *
 * No unrestricted shell, filesystem, or credential access is provided here. A
 * concrete provider must expose only explicitly named, individually reviewed
 * tools. `InMemoryToolProvider` is a test/local double backed by an explicit
 * handler map.
 */
import type { ToolProvider, ToolRequest, ToolResponse } from "../../contracts/index.js";
export type { ToolProvider, ToolRequest, ToolResponse, } from "../../contracts/index.js";
export type ToolHandler = (input: unknown, request: ToolRequest) => Promise<unknown> | unknown;
export declare class InMemoryToolProvider implements ToolProvider {
    readonly id: string;
    private readonly handlers;
    constructor(id: string, handlers: Record<string, ToolHandler>);
    get tools(): readonly string[];
    execute(request: ToolRequest): Promise<ToolResponse>;
}
