import type { OperatorRole } from "./control.js";
/** Decoded image size limit (the UI downsizes to 256×256 before upload). */
export declare const MAX_AVATAR_BYTES: number;
export interface OperatorProfile {
    /** Firebase UID (same id as the operator account). */
    id: string;
    avatarDataUrl?: string;
    updatedAt: string;
}
/** `GET /api/me/profile` — the caller's own profile. */
export interface MyProfileView {
    operatorId: string;
    displayName?: string;
    email?: string;
    emailVerified: boolean;
    role: OperatorRole;
    allowedProjects: readonly string[] | "*";
    avatarDataUrl?: string;
}
export interface OperatorProfileStore {
    get(operatorId: string): Promise<OperatorProfile | undefined>;
    save(profile: OperatorProfile): Promise<void>;
    remove(operatorId: string): Promise<void>;
}
/**
 * Accept only a PNG/JPEG/WebP data URL whose bytes really are that image
 * type and whose decoded size is within `MAX_AVATAR_BYTES`. Returns the
 * value unchanged; throws `ValidationError` otherwise.
 */
export declare function validateAvatarDataUrl(value: unknown): string;
