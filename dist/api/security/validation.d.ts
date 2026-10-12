import type { IncomingMessage } from "node:http";
export declare function enforceMethod(req: IncomingMessage, allowedMethods: readonly string[]): void;
export declare function enforceContentType(req: IncomingMessage, expectedType?: string): void;
export declare function readJsonBodyStrict(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>>;
