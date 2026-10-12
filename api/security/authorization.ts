import type { ControlCapability } from "../../contracts/control.js";
import { operatorCan, operatorCanAccessProject } from "../../contracts/control.js";
import { ForbiddenError, UnauthorizedError } from "./errors.js";
import type { SecureRequestContext } from "./request-context.js";

export function requireAuthenticatedRequest(ctx: SecureRequestContext): NonNullable<SecureRequestContext["principal"]> {
  if (!ctx.authenticated || !ctx.identity) {
    throw new UnauthorizedError("Unauthenticated request");
  }
  if (!ctx.authorized || !ctx.principal) {
    // Identity is valid but account is missing/pending/suspended/rejected
    throw new ForbiddenError("Account is not authorized");
  }
  return ctx.principal;
}

export function requireCapability(ctx: SecureRequestContext, capability: ControlCapability): void {
  const principal = requireAuthenticatedRequest(ctx);
  if (!operatorCan(principal, capability)) {
    throw new ForbiddenError(`Missing required capability: ${capability}`);
  }
}

export function requireProjectAccess(ctx: SecureRequestContext, projectId: string): void {
  const principal = requireAuthenticatedRequest(ctx);
  if (!operatorCanAccessProject(principal, projectId)) {
    throw new ForbiddenError(`Access denied to project: ${projectId}`);
  }
}
