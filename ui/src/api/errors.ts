export interface ApiErrorDetails {
  code?: string;
  status?: number;
  requestId?: string;
}

export class ApiError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly requestId?: string;

  constructor(message: string, details: ApiErrorDetails = {}) {
    super(message);

    this.name = "ApiError";
    this.code = details.code;
    this.status = details.status;
    this.requestId = details.requestId;
  }
}