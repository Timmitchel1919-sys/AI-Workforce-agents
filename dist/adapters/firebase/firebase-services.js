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
function safeEnv() {
    try {
        return globalThis.process?.env ?? {};
    }
    catch {
        return {};
    }
}
export function loadFirebaseConfig(env = safeEnv()) {
    const projectId = (env.FIREBASE_PROJECT_ID ??
        env.GOOGLE_CLOUD_PROJECT ??
        env.GCLOUD_PROJECT ??
        "").trim();
    if (!projectId) {
        throw new ValidationError("missing Firebase project id: set FIREBASE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT)");
    }
    const emulated = Boolean((env.FIRESTORE_EMULATOR_HOST ?? "").trim());
    const storageBucket = (env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`).trim();
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
async function importFirebase(subpath) {
    try {
        return (await import(`firebase-admin/${subpath}`));
    }
    catch {
        throw new ValidationError("the 'firebase-admin' package is not installed; run: npm install firebase-admin");
    }
}
/**
 * Initialise (or reuse) the Firebase app and return the three service seams.
 * Never throws with a credential in the message.
 */
export async function createFirebaseServices(config = loadFirebaseConfig()) {
    const appMod = await importFirebase("app");
    const existing = appMod.getApps();
    const app = existing.length > 0
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
        importFirebase("firestore"),
        importFirebase("auth"),
        importFirebase("storage"),
    ]);
    return {
        firestore: firestoreMod.getFirestore(app),
        auth: authMod.getAuth(app),
        storage: storageMod.getStorage(app),
        config,
    };
}
