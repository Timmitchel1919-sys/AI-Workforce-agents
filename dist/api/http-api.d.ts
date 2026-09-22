/**
 * Control Plane HTTP API.
 *
 * A dependency-free Node `http` request handler that exposes
 * `WorkforceQueryService` (read) and `WorkforceCommandService` (write) over
 * JSON. This is the seam the Phase 7C UI consumes:
 *
 *   UI → HTTP API → Query / Command service → Core → Repository → Firebase
 *
 * The API is NOT the authority. It authenticates the caller (via the injected
 * `OperatorDirectory`), threads a correlation id, maps errors and command
 * `errorKind`s to status codes, and forwards everything else to the two
 * services — which enforce authorization, approval, state, project isolation,
 * and audit. No stack trace is ever sent to a client.
 */
import { type IncomingMessage, type ServerResponse } from "node:http";
import { type OperatorDirectory } from "../contracts/index.js";
import { type WorkforceCommandService, type WorkforceQueryService } from "../control/index.js";
export interface ControlPlaneApiOptions {
    query: WorkforceQueryService;
    command: WorkforceCommandService;
    operatorDirectory: OperatorDirectory;
    /** Path prefix for every route. Default `/api`. */
    basePath?: string;
    /** Request header carrying an inbound correlation id. Default `x-correlation-id`. */
    correlationHeader?: string;
    generateCorrelationId?: () => string;
    /** Max JSON request body size in bytes. Default 1 MiB. */
    maxBodyBytes?: number;
}
export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void;
export declare function createControlPlaneApi(options: ControlPlaneApiOptions): ApiHandler;
