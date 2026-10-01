export interface IdentityProvider {
  providerId: string;
  organizationId: string;
  type: "SAML" | "OIDC" | "OAUTH2" | "LDAP";
  name: string;
  status: "ACTIVE" | "INACTIVE" | "PENDING_VERIFICATION";
  configuration: Record<string, any>;
  domainMapping: string[]; // e.g., ["acme.com"]
  createdAt: Date;
  updatedAt: Date;
}

export interface UserIdentity {
  userId: string;
  organizationId: string;
  providerId?: string;
  email: string;
  name: string;
  roles: string[];
  status: "ACTIVE" | "SUSPENDED" | "INVITED";
  lastLoginAt?: Date;
}

export interface SsoSession {
  sessionId: string;
  userId: string;
  organizationId: string;
  providerId: string;
  ipAddress: string;
  userAgent: string;
  issuedAt: Date;
  expiresAt: Date;
  isValid: boolean;
}

export interface ScimProvisioningEvent {
  eventId: string;
  organizationId: string;
  action: "USER_CREATED" | "USER_UPDATED" | "USER_DELETED" | "GROUP_CREATED" | "GROUP_UPDATED" | "GROUP_DELETED";
  payload: any;
  status: "PROCESSED" | "FAILED" | "PENDING";
  receivedAt: Date;
}
