/**
 * Firestore `OperatorProfileStore`: `operator_profiles/{firebaseUid}`.
 * Written only by the Control Plane (Admin SDK); client rules stay deny-all.
 */
import type { OperatorProfile, OperatorProfileStore } from "../../contracts/index.js";
import type { FirestoreLike } from "./firebase-services.js";
export declare const OPERATOR_PROFILES_COLLECTION = "operator_profiles";
export declare class FirestoreOperatorProfileStore implements OperatorProfileStore {
    private readonly collection;
    constructor(firestore: FirestoreLike, options?: {
        collectionPrefix?: string;
    });
    get(operatorId: string): Promise<OperatorProfile | undefined>;
    save(profile: OperatorProfile): Promise<void>;
    remove(operatorId: string): Promise<void>;
}
