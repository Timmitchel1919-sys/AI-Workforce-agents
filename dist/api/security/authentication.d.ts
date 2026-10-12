import type { IncomingMessage } from "node:http";
import type { IdentityVerifier, OperatorDirectory } from "../../contracts/index.js";
import type { SecureRequestContext } from "./request-context.js";
/**
 * Best-effort authentication: resolves `ctx.identity` / `ctx.principal` when
 * a bearer token is present and valid, otherwise leaves the request
 * unauthenticated. Deliberately never throws — some routes are reachable
 * without a token (signed provider webhooks, `/me/access`), and for every
 * other route `handle()` already issues its own route-aware 401 once it
 * sees `ctx.principal` / `ctx.identity` are unset. Throwing here for a
 * missing or invalid token would short-circuit those checks and incorrectly
 * 401 routes that are supposed to stay public.
 */
export declare function authenticateRequest(req: IncomingMessage, ctx: SecureRequestContext, identityVerifier?: IdentityVerifier, operatorDirectory?: OperatorDirectory): Promise<void>;
