import {
  IdentityProvider,
  UserIdentity,
  SsoSession,
} from "../../contracts/identity.js";

export interface IdentityProfile {
  email: string;
  name: string;
  roles?: string[];
}

export class SsoService {
  private providers = new Map<string, IdentityProvider>();
  private domainMap = new Map<string, string>(); // domain -> providerId
  private users = new Map<string, UserIdentity>();
  private sessions = new Map<string, SsoSession>();

  registerProvider(provider: IdentityProvider) {
    this.providers.set(provider.providerId, provider);
    for (const domain of provider.domainMapping) {
      if (this.domainMap.has(domain)) {
        throw new Error(
          `Domain ${domain} is already mapped to another provider`,
        );
      }
      this.domainMap.set(domain, provider.providerId);
    }
  }

  getProviderForDomain(domain: string): IdentityProvider | undefined {
    const providerId = this.domainMap.get(domain);
    return providerId ? this.providers.get(providerId) : undefined;
  }

  syncUserFromIdp(
    organizationId: string,
    providerId: string,
    profile: IdentityProfile,
  ): UserIdentity {
    const existing = Array.from(this.users.values()).find(
      (u) => u.email === profile.email,
    );

    if (existing) {
      existing.name = profile.name || existing.name;
      existing.roles = profile.roles || existing.roles;
      existing.providerId = providerId;
      return existing;
    }

    const newUser: UserIdentity = {
      userId: `usr_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      organizationId,
      providerId,
      email: profile.email,
      name: profile.name,
      roles: profile.roles || ["USER"],
      status: "ACTIVE",
    };

    this.users.set(newUser.userId, newUser);
    return newUser;
  }

  createSession(
    userId: string,
    providerId: string,
    ipAddress: string,
    userAgent: string,
  ): SsoSession {
    const user = this.users.get(userId);
    if (!user) throw new Error("User not found");
    if (user.status !== "ACTIVE") throw new Error("User account is not active");

    const session: SsoSession = {
      sessionId: `sess_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      userId,
      organizationId: user.organizationId,
      providerId,
      ipAddress,
      userAgent,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
      isValid: true,
    };

    this.sessions.set(session.sessionId, session);
    user.lastLoginAt = new Date();
    return session;
  }

  validateSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isValid) return false;

    if (new Date() > session.expiresAt) {
      session.isValid = false;
      return false;
    }

    return true;
  }

  revokeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isValid = false;
    }
  }

  getUser(userId: string): UserIdentity | undefined {
    return this.users.get(userId);
  }

  suspendUserByEmail(email: string): boolean {
    const user = Array.from(this.users.values()).find(
      (candidate) => candidate.email === email,
    );
    if (!user) return false;
    user.status = "SUSPENDED";
    return true;
  }
}
