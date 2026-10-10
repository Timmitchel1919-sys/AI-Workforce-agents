/**
 * ProfileService — the signed-in operator's own profile (photo only).
 *
 * Self-service: an ACTIVE operator reads and edits only their own profile;
 * the operator id always comes from the verified principal, never from the
 * request. Identity fields (email, display name, role) are read from the
 * authoritative `OperatorAccount` and are never writable here. Photo changes
 * are audited (`access_event`) without the image data.
 */
import { type MyProfileView, type OperatorAccountStore, type OperatorPrincipal, type OperatorProfileStore } from "../../contracts/index.js";
import { type AuditLog } from "../audit/audit-log.js";
export interface ProfileServiceOptions {
    profiles: OperatorProfileStore;
    accounts: Pick<OperatorAccountStore, "get">;
    audit: AuditLog;
    clock?: () => string;
}
export declare class ProfileService {
    private readonly options;
    private readonly clock;
    constructor(options: ProfileServiceOptions);
    myProfile(principal: OperatorPrincipal): Promise<MyProfileView>;
    setPhoto(principal: OperatorPrincipal, dataUrl: unknown, correlationId?: string): Promise<MyProfileView>;
    removePhoto(principal: OperatorPrincipal, correlationId?: string): Promise<MyProfileView>;
    private record;
}
