import type { Entity } from "../../contracts/index.js";
import type { FirestoreLike } from "./firebase-services.js";
import { firestoreRepository } from "./firestore-repository.js";
import type { BackupPolicy, BackupJob, BackupManifest, RecoveryPoint, RestorePlan, RestoreJob, RestoreVerification, RecoveryDrill } from "../../contracts/secops.js";
type Durable<T> = T & Entity;
export class BackupPolicyRepository extends FirestoreRepository<Durable<BackupPolicy>> {}
export class BackupJobRepository extends FirestoreRepository<BackupJob> {}
export class BackupManifestRepository extends FirestoreRepository<BackupManifest> {}
export class RecoveryPointRepository extends FirestoreRepository<Durable<RecoveryPoint>> {}
export class RestorePlanRepository extends FirestoreRepository<Durable<RestorePlan>> {}
export class RestoreJobRepository extends FirestoreRepository<RestoreJob> {}
export class RestoreVerificationRepository extends FirestoreRepository<RestoreVerification> {}
export class RecoveryDrillRepository extends FirestoreRepository<RecoveryDrill> {}
export function createSecOpsRepositories(firestore: FirestoreLike) {
  return {
    backupPolicies: firestoreRepository<Durable<BackupPolicy>>(firestore, "backup_policies"),
    backupJobs: firestoreRepository<BackupJob>(firestore, "backup_jobs"),
    backupManifests: firestoreRepository<BackupManifest>(firestore, "backup_manifests"),
    recoveryPoints: firestoreRepository<Durable<RecoveryPoint>>(firestore, "recovery_points"),
    restorePlans: firestoreRepository<Durable<RestorePlan>>(firestore, "restore_plans"),
    restoreJobs: firestoreRepository<RestoreJob>(firestore, "restore_jobs"),
    restoreVerifications: firestoreRepository<RestoreVerification>(firestore, "restore_verifications"),
    recoveryDrills: firestoreRepository<RecoveryDrill>(firestore, "recovery_drills"),
  };
}
