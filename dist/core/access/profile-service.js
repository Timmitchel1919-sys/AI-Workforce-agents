/**
 * ProfileService — the signed-in operator's own profile (photo only).
 *
 * Self-service: an ACTIVE operator reads and edits only their own profile;
 * the operator id always comes from the verified principal, never from the
 * request. Identity fields (email, display name, role) are read from the
 * authoritative `OperatorAccount` and are never writable here. Photo changes
 * are audited (`access_event`) without the image data.
 */
import { validateAvatarDataUrl, } from "../../contracts/index.js";
import { now } from "../shared.js";
export class ProfileService {
    options;
    clock;
    constructor(options) {
        this.options = options;
        this.clock = options.clock ?? now;
    }
    async myProfile(principal) {
        const [account, profile] = await Promise.all([
            this.options.accounts.get(principal.id),
            this.options.profiles.get(principal.id),
        ]);
        return {
            operatorId: principal.id,
            ...(account?.displayName ? { displayName: account.displayName } : {}),
            ...(account?.email ? { email: account.email } : {}),
            emailVerified: account?.emailVerified ?? false,
            role: principal.role,
            allowedProjects: principal.allowedProjects,
            ...(profile?.avatarDataUrl
                ? { avatarDataUrl: profile.avatarDataUrl }
                : {}),
        };
    }
    async setPhoto(principal, dataUrl, correlationId) {
        const avatarDataUrl = validateAvatarDataUrl(dataUrl);
        await this.options.profiles.save({
            id: principal.id,
            avatarDataUrl,
            updatedAt: this.clock(),
        });
        this.record("profile_photo_updated", principal.id, correlationId);
        return this.myProfile(principal);
    }
    async removePhoto(principal, correlationId) {
        await this.options.profiles.remove(principal.id);
        this.record("profile_photo_removed", principal.id, correlationId);
        return this.myProfile(principal);
    }
    record(action, operatorId, correlationId) {
        this.options.audit.record("access_event", {
            data: {
                action,
                actor: operatorId,
                operatorId,
                ...(correlationId ? { correlationId } : {}),
            },
        });
    }
}
