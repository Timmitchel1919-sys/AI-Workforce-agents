/**
 * Firebase service boundary.
 *
 * This module is the ONLY place that knows the `firebase-admin` SDK exists. It
 * loads it lazily (an optional peer dependency), initialises one app from the
 * environment, and hands back three narrow seams — `FirestoreLike`,
 * `FirebaseAuthLike`, `FirebaseStorageLike` — that the individual adapters and
 * their tests are written against. Tests inject fakes for those seams and never
 * touch `firebase-admin`.
 *
 * Credentials are never inlined, logged, or committed. They come from the
 * standard Google environment variables:
 *
 *   FIREBASE_PROJECT_ID              project id (or GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT)
 *   GOOGLE_APPLICATION_CREDENTIALS   path to a service-account JSON key (gitignored)
 *   FIREBASE_STORAGE_BUCKET          storage bucket (default: <projectId>.appspot.com)
 *   FIRESTORE_EMULATOR_HOST          when set, use the local emulator (no credentials)
 *   FIREBASE_AUTH_EMULATOR_HOST      auth emulator host
 */
import { ValidationError } from "../../contracts/index.js";

/* ------------------------------------------------------------------ */
/* Narrow seams                                                       */
/* ------------------------------------------------------------------ */

export interface FirestoreDocSnapshotLike {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface FirestoreQueryDocLike {
  readonly id: string;
  data(): Record<string, unknown>;
}

export interface FirestoreDocRefLike {
  set(data: Record<string, unknown>): Promise<unknown>;
  get(): Promise<FirestoreDocSnapshotLike>;
  delete(): Promise<unknown>;
}

export interface FirestoreQuerySnapshotLike {
  readonly docs: readonly FirestoreQueryDocLike[];
}

export interface FirestoreCollectionLike {
  doc(id: string): FirestoreDocRefLike;
  get(): Promise<FirestoreQuerySnapshotLike>;
  listDocuments(): Promise<readonly FirestoreDocRefLike[]>;
}

export interface FirestoreLike {
  collection(path: string): FirestoreCollectionLike;
}

export interface DecodedTokenLike {
  uid: string;
  [claim: string]: unknown;
}

export interface FirebaseAuthLike {
  verifyIdToken(idToken: string): Promise<DecodedTokenLike>;
}

export interface StorageFileLike {
  readonly name: string;
  save(
    data: Buffer | string,
    options?: {
      contentType?: string;
      metadata?: { metadata?: Record<string, string> };
    },
  ): Promise<unknown>;
  download(): Promise<[Buffer]>;
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[Record<string, unknown>]>;
  delete(): Promise<unknown>;
  getSignedUrl(options: { action: "read"; expires: number }): Promise<[string]>;
}

export interface StorageBucketLike {
  file(key: string): StorageFileLike;
  getFiles(options: { prefix: string }): Promise<[readonly StorageFileLike[]]>;
}

export interface FirebaseStorageLike {
  bucket(name?: string): StorageBucketLike;
}

/* ------------------------------------------------------------------ */
/* Configuration                                                      */
/* ------------------------------------------------------------------ */

export interface FirebaseConfig {
  projectId: string;
  storageBucket: string;
  /** True when a Firestore emulator host is configured — no credentials needed. */
  emulated: boolean;
  /** Explicit service-account key path, if `GOOGLE_APPLICATION_CREDENTIALS` is set. */
  credentialsPath?: string;
}

type EnvLike = Record<string, string | undefined>;

function safeEnv(): EnvLike {
  try {
    return (globalThis as { process?: { env?: EnvLike } }).process?.env ?? {};
  } catch {
    return {};
  }
}

export function loadFirebaseConfig(env: EnvLike = safeEnv()): FirebaseConfig {
  const projectId = (
    env.FIREBASE_PROJECT_ID ??
    env.GOOGLE_CLOUD_PROJECT ??
    env.GCLOUD_PROJECT ??
    ""
  ).trim();
  if (!projectId) {
    throw new ValidationError(
      "missing Firebase project id: set FIREBASE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT)",
    );
  }
  const emulated = Boolean((env.FIRESTORE_EMULATOR_HOST ?? "").trim());
  const storageBucket = (
    env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`
  ).trim();
  const credentialsPath = (env.GOOGLE_APPLICATION_CREDENTIALS ?? "").trim();
  return {
    projectId,
    storageBucket,
    emulated,
    ...(credentialsPath ? { credentialsPath } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Lazy SDK load                                                      */
/* ------------------------------------------------------------------ */

async function importFirebase<T>(subpath: string): Promise<T> {
  try {
    return (await import(`firebase-admin/${subpath}`)) as T;
  } catch {
    throw new ValidationError(
      "the 'firebase-admin' package is not installed; run: npm install firebase-admin",
    );
  }
}

export interface FirebaseServices {
  firestore: FirestoreLike;
  auth: FirebaseAuthLike;
  storage: FirebaseStorageLike;
  config: FirebaseConfig;
}

interface AppModuleLike {
  initializeApp(options: Record<string, unknown>): unknown;
  getApps(): unknown[];
  applicationDefault(): unknown;
  cert(path: string): unknown;
}
interface FirestoreModuleLike {
  getFirestore(app: unknown): FirestoreLike;
}
interface AuthModuleLike {
  getAuth(app: unknown): FirebaseAuthLike;
}
interface StorageModuleLike {
  getStorage(app: unknown): FirebaseStorageLike;
}

/**
 * Initialise (or reuse) the Firebase app and return the three service seams.
 * Never throws with a credential in the message.
 */
export async function createFirebaseServices(
  config: FirebaseConfig = loadFirebaseConfig(),
): Promise<FirebaseServices> {
  const appMod = await importFirebase<AppModuleLike>("app");
  const existing = appMod.getApps();
  const app =
    existing.length > 0
      ? existing[0]
      : appMod.initializeApp({
          projectId: config.projectId,
          storageBucket: config.storageBucket,
          ...(config.emulated
            ? {}
            : {
                credential: config.credentialsPath
                  ? appMod.cert(config.credentialsPath)
                  : appMod.applicationDefault(),
              }),
        });

  const [firestoreMod, authMod, storageMod] = await Promise.all([
    importFirebase<FirestoreModuleLike>("firestore"),
    importFirebase<AuthModuleLike>("auth"),
    importFirebase<StorageModuleLike>("storage"),
  ]);

  return {
    firestore: firestoreMod.getFirestore(app),
    auth: authMod.getAuth(app),
    storage: storageMod.getStorage(app),
    config,
  };
}
