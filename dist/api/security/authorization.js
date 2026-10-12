import { operatorCan, operatorCanAccessProject } from "../../contracts/control.js";
import { ForbiddenError, UnauthorizedError } from "./errors.js";
export function requireAuthenticatedRequest(ctx) {
    if (!ctx.authenticated || !ctx.identity) {
        throw new UnauthorizedError("Unauthenticated request");
    }
    if (!ctx.authorized || !ctx.principal) {
        // Identity is valid but account is missing/pending/suspended/rejected
        throw new ForbiddenError("Account is not authorized");
    }
    return ctx.principal;
}
export function requireCapability(ctx, capability) {
    const principal = requireAuthenticatedRequest(ctx);
    if (!operatorCan(principal, capability)) {
        throw new ForbiddenError(`Missing required capability: ${capability}`);
    }
}
export function requireProjectAccess(ctx, projectId) {
    const principal = requireAuthenticatedRequest(ctx);
    if (!operatorCanAccessProject(principal, projectId)) {
        throw new ForbiddenError(`Access denied to project: ${projectId}`);
    }
}
