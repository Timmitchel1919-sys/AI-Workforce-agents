export interface ApiErrorDetails {
  code?: string;
  status?: number;
  requestId?: string;
  /** Control Plane command error kind (invalid_state, forbidden, …) when the body carried one. */
  errorKind?: string;
  /** Operator-safe explanation from a command result body (`reason`). */
  reason?: string;
}

export class ApiError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly errorKind?: string;
  readonly reason?: string;

  constructor(message: string, details: ApiErrorDetails = {}) {
    super(message);

    this.name = "ApiError";
    this.code = details.code;
    this.status = details.status;
    this.requestId = details.requestId;
    this.errorKind = details.errorKind;
    this.reason = details.reason;
  }
}