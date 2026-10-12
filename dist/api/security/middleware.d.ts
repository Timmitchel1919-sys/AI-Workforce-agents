import type { IncomingMessage, ServerResponse } from "node:http";
import type { IdentityVerifier, OperatorDirectory } from "../../contracts/index.js";
import { SecureRequestContext } from "./request-context.js";
import type { RateLimiter } from "./rate-limit.js";
import type { AppAttestationVerifier, AppCheckEnforcementMode } from "./app-check.js";
export declare function processSecurityLayer(req: IncomingMessage, res: ServerResponse, options: {
    identityVerifier?: IdentityVerifier;
    operatorDirectory?: OperatorDirectory;
    appAttestationVerifier?: AppAttestationVerifier;
    appCheckMode?: AppCheckEnforcementMode;
    correlationId?: string;
    rateLimiter: RateLimiter;
}): Promise<SecureRequestContext>;
