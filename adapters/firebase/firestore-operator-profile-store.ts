/**
 * Firestore `OperatorProfileStore`: `operator_profiles/{firebaseUid}`.
 * Written only by the Control Plane (Admin SDK); client rules stay deny-all.
 */
import type {
  OperatorProfile,
  OperatorProfileStore,
} from "../../contracts/index.js";
import type {
  FirestoreCollectionLike,
  FirestoreLike,
} from "./firebase-services.js";

export const OPERATOR_PROFILES_COLLECTION = "operator_profiles";

export class FirestoreOperatorProfileStore implements OperatorProfileStore {
  private readonly collection: FirestoreCollectionLike;

  constructor(
    firestore: FirestoreLike,
    options: { collectionPrefix?: string } = {},
  ) {
    this.collection = firestore.collection(
      (options.collectionPrefix ?? "") + OPERATOR_PROFILES_COLLECTION,
    );
  }

  async get(operatorId: string): Promise<OperatorProfile | undefined> {
    const snap = await this.collection.doc(operatorId).get();
    const data = snap.exists ? snap.data() : undefined;
    if (!data || typeof data.id !== "string") return undefined;
    return {
      id: data.id,
      ...(typeof data.avatarDataUrl === "string"
        ? { avatarDataUrl: data.avatarDataUrl }
        : {}),
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
    };
  }

  async save(profile: OperatorProfile): Promise<void> {
    await this.collection
      .doc(profile.id)
      .set(JSON.parse(JSON.stringify(profile)) as Record<string, unknown>);
  }

  async remove(operatorId: string): Promise<void> {
    await this.collection.doc(operatorId).delete();
  }
}
