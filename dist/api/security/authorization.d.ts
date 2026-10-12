import type { ControlCapability } from "../../contracts/control.js";
import type { SecureRequestContext } from "./request-context.js";
export declare function requireAuthenticatedRequest(ctx: SecureRequestContext): NonNullable<SecureRequestContext["principal"]>;
export declare function requireCapability(ctx: SecureRequestContext, capability: ControlCapability): void;
export declare function requireProjectAccess(ctx: SecureRequestContext, projectId: string): void;
