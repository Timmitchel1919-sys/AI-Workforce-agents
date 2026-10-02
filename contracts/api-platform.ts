export interface ApiKey {
  keyId: string;
  organizationId: string;
  name: string;
  prefix: string; // The visible part, e.g., sk_live_***1234
  hash: string; // BCrypt/Argon2 hash of the secret
  scopes: string[]; // e.g., ["read:billing", "write:users"]
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  expiresAt?: Date;
  lastUsedAt?: Date;
  createdAt: Date;
}

export interface OAuthApp {
  clientId: string;
  organizationId: string;
  name: string;
  description: string;
  redirectUris: string[];
  clientSecretHash: string;
  allowedScopes: string[];
  status: "ACTIVE" | "SUSPENDED";
  createdAt: Date;
}

export interface WebhookEndpoint {
  endpointId: string;
  organizationId: string;
  url: string;
  description: string;
  events: string[]; // e.g., ["customer.created", "invoice.paid"]
  secret: string; // Shared secret for HMAC signature
  status: "ACTIVE" | "INACTIVE" | "FAILING";
  failureCount: number;
  createdAt: Date;
}

export interface WebhookDelivery {
  deliveryId: string;
  endpointId: string;
  eventId: string;
  payload: any;
  status: "SUCCESS" | "FAILED";
  statusCode?: number;
  responseBody?: string;
  attempt: number;
  deliveredAt: Date;
}
