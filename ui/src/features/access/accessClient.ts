/**
 * Users & Access API (AUTHZ-1). Same-origin Control Plane only; the Firebase
 * ID token is forwarded by `apiRequest`. The browser never writes Firestore
 * and never decides a role — every change is a backend command that the
 * Control Plane authorizes, validates and audits.
 */
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";

export type OperatorRole = "viewer" | "operator" | "admin";
export type AccountStatus = "pending" | "active" | "suspended" | "rejected" | "revoked";

/** `GET /api/operators` item (contracts/access.ts `OperatorAccountView`). */
export interface OperatorAccountView {
  operatorId: string;
  email?: string;
  displayName?: string;
  emailVerified: boolean;
  status: AccountStatus;
  role?: OperatorRole;
  allowedProjects: readonly string[] | "*";
  requestedAt: string;
  updatedAt: string;
  decidedAt?: string;
  statusReason?: string;
  isSelf: boolean;
}

export type AccessCommand =
  | "approve-access"
  | "reject-access"
  | "suspend-access"
  | "reactivate-access"
  | "revoke-access"
  | "change-operator-role";

export interface AccessCommandBody {
  operatorId: string;
  role?: OperatorRole;
  allowedProjects?: readonly string[] | "*";
  reason?: string;
}

export type AccessFailure = "forbidden" | "conflict" | "invalid" | "unauthenticated" | "unknown";

export class AccessClientError extends Error {
  readonly failure: AccessFailure;
  constructor(failure: AccessFailure, message: string) {
    super(message);
    this.name = "AccessClientError";
    this.failure = failure;
  }
}

function toFailure(error: unknown): AccessClientError {
  if (error instanceof ApiError) {
    const failure: AccessFailure =
      error.status === 401
        ? "unauthenticated"
        : error.status === 403
          ? "forbidden"
          : error.status === 409
            ? "conflict"
            : error.status === 400 || error.status === 404
              ? "invalid"
              : "unknown";
    return new AccessClientError(failure, error.message);
  }
  return new AccessClientError("unknown", "request failed");
}

export async function getOperators(accessToken?: string | null): Promise<OperatorAccountView[]> {
  try {
    return await apiRequest<OperatorAccountView[]>("/api/operators", {
      method: "GET",
      accessToken,
    });
  } catch (error) {
    throw toFailure(error);
  }
}

export async function runAccessCommand(
  command: AccessCommand,
  body: AccessCommandBody,
  accessToken?: string | null,
): Promise<void> {
  try {
    await apiRequest(`/api/commands/${command}`, {
      method: "POST",
      body: JSON.stringify(body),
      accessToken,
    });
  } catch (error) {
    throw toFailure(error);
  }
}
