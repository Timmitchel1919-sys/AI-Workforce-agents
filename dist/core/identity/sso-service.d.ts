import { IdentityProvider, UserIdentity, SsoSession } from "../../contracts/identity.js";
export declare class SsoService {
    private providers;
    private domainMap;
    private users;
    private sessions;
    registerProvider(provider: IdentityProvider): void;
    getProviderForDomain(domain: string): IdentityProvider | undefined;
    syncUserFromIdp(organizationId: string, providerId: string, profile: any): UserIdentity;
    createSession(userId: string, providerId: string, ipAddress: string, userAgent: string): SsoSession;
    validateSession(sessionId: string): boolean;
    revokeSession(sessionId: string): void;
    getUser(userId: string): UserIdentity | undefined;
}
