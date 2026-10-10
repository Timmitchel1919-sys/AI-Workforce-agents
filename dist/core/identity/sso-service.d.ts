import { IdentityProvider, UserIdentity, SsoSession } from "../../contracts/identity.js";
export interface IdentityProfile {
    email: string;
    name: string;
    roles?: string[];
}
export declare class SsoService {
    private providers;
    private domainMap;
    private users;
    private sessions;
    registerProvider(provider: IdentityProvider): void;
    getProviderForDomain(domain: string): IdentityProvider | undefined;
    syncUserFromIdp(organizationId: string, providerId: string, profile: IdentityProfile): UserIdentity;
    createSession(userId: string, providerId: string, ipAddress: string, userAgent: string): SsoSession;
    validateSession(sessionId: string): boolean;
    revokeSession(sessionId: string): void;
    getUser(userId: string): UserIdentity | undefined;
    suspendUserByEmail(email: string): boolean;
}
