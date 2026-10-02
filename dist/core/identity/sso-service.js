export class SsoService {
    providers = new Map();
    domainMap = new Map(); // domain -> providerId
    users = new Map();
    sessions = new Map();
    registerProvider(provider) {
        this.providers.set(provider.providerId, provider);
        for (const domain of provider.domainMapping) {
            if (this.domainMap.has(domain)) {
                throw new Error(`Domain ${domain} is already mapped to another provider`);
            }
            this.domainMap.set(domain, provider.providerId);
        }
    }
    getProviderForDomain(domain) {
        const providerId = this.domainMap.get(domain);
        return providerId ? this.providers.get(providerId) : undefined;
    }
    syncUserFromIdp(organizationId, providerId, profile) {
        const existing = Array.from(this.users.values()).find(u => u.email === profile.email);
        if (existing) {
            existing.name = profile.name || existing.name;
            existing.roles = profile.roles || existing.roles;
            existing.providerId = providerId;
            return existing;
        }
        const newUser = {
            userId: `usr_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            organizationId,
            providerId,
            email: profile.email,
            name: profile.name,
            roles: profile.roles || ["USER"],
            status: "ACTIVE"
        };
        this.users.set(newUser.userId, newUser);
        return newUser;
    }
    createSession(userId, providerId, ipAddress, userAgent) {
        const user = this.users.get(userId);
        if (!user)
            throw new Error("User not found");
        if (user.status !== "ACTIVE")
            throw new Error("User account is not active");
        const session = {
            sessionId: `sess_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            userId,
            organizationId: user.organizationId,
            providerId,
            ipAddress,
            userAgent,
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
            isValid: true
        };
        this.sessions.set(session.sessionId, session);
        user.lastLoginAt = new Date();
        return session;
    }
    validateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.isValid)
            return false;
        if (new Date() > session.expiresAt) {
            session.isValid = false;
            return false;
        }
        return true;
    }
    revokeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.isValid = false;
        }
    }
    getUser(userId) {
        return this.users.get(userId);
    }
}
