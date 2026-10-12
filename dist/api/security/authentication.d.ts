import type { IncomingMessage } from "node:http";
import type { IdentityVerifier, OperatorDirectory } from "../../contracts/index.js";
import type { SecureRequestContext } from "./request-context.js";
export declare function authenticateRequest(req: IncomingMessage, ctx: SecureRequestContext, identityVerifier?: IdentityVerifier, operatorDirectory?: OperatorDirectory): Promise<void>;
