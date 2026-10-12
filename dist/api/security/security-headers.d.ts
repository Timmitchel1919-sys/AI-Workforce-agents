import type { ServerResponse } from "node:http";
export declare function setSecurityHeaders(res: ServerResponse): void;
export declare function setCorsHeaders(res: ServerResponse, allowedOrigin: string): void;
