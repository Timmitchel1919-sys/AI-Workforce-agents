/**
 * Trusted, one-time initial administrator bootstrap (AUTHZ-1).
 *
 * Runs locally with Firebase Admin credentials (Application Default
 * Credentials or GOOGLE_APPLICATION_CREDENTIALS pointing OUTSIDE the repo).
 * The identity is supplied at run time and never committed:
 *
 *   INITIAL_ADMIN_UID=<uid> FIREBASE_PROJECT_ID=ai-workforce-agents npm run admin:bootstrap
 *
 * See docs/access-control.md. Excluded from the Functions upload ("scripts").
 */
import { createFirebaseServices } from "../dist/adapters/firebase/index.js";
import {
  bootstrapInitialAdministrator,
  maskIdentifier,
} from "../dist/api/bootstrap-initial-admin.js";

const uid = (process.env.INITIAL_ADMIN_UID ?? "").trim();
if (!uid) {
  console.error(
    "INITIAL_ADMIN_UID is not set. Copy the UID from Firebase Console → Authentication → Users.",
  );
  process.exit(1);
}

try {
  const services = await createFirebaseServices();
  const result = await bootstrapInitialAdministrator({ services, uid });
  console.log(
    `[bootstrap] ${result.outcome}: ${result.message} (uid ${maskIdentifier(uid)}, project ${services.config.projectId})`,
  );
  process.exitCode = result.outcome === "refused" ? 2 : 0;
} catch (error) {
  // Messages are safe by construction (no credentials, no full identifiers).
  console.error(
    `[bootstrap] failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
}
