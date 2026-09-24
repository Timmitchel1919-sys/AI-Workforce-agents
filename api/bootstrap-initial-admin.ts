/**
 * Initial administrator bootstrap (AUTHZ-1) — a TRUSTED, server-side,
 * one-time operation. It is not an HTTP route, not a Cloud Function, and never
 * part of the browser bundle; it runs from an operator's machine with Firebase
 * Admin credentials (ADC or a service-account key outside the repository):
 *
 *   INITIAL_ADMIN_UID=<firebase uid> FIREBASE_PROJECT_ID=ai-workforce-agents \
 *     npm run admin:bootstrap
 *
 * It verifies the Firebase user exists and is enabled, then asks the
 * AccessService to provision that EXISTING identity as the first `admin`.
 * The store commits it atomically together with a bootstrap lock: re-running
 * for the same administrator is a no-op ("already_provisioned"); any other
 * identity — or any run once an administrator exists — is refused. No UID or
 * email is ever hardcoded; the identity is supplied at run time.
 */
import {
  BootstrapLockedError,
  ValidationError,
  type AuditEvent,
} from "../contracts/index.js";
import {
  FirestoreOperatorAccountStore,
  firestoreRepository,
  isTransactionalFirestore,
  type FirebaseServices,
} from "../adapters/firebase/index.js";
import { AccessService, AuditLog } from "../core/index.js";

export type InitialAdminBootstrapOutcome =
  "created" | "already_provisioned" | "refused";

export interface InitialAdminBootstrapResult {
  outcome: InitialAdminBootstrapOutcome;
  message: string;
}

/** Mask an identifier for console output (never print it in full). */
export function maskIdentifier(value: string): string {
  return value.length <= 6 ? "••••" : `${value.slice(0, 4)}…${value.slice(-2)}`;
}

export async function bootstrapInitialAdministrator(options: {
  services: FirebaseServices;
  uid: string;
  collectionPrefix?: string;
}): Promise<InitialAdminBootstrapResult> {
  const uid = options.uid.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new ValidationError("INITIAL_ADMIN_UID is not a valid Firebase UID");
  }
  const { auth, firestore } = options.services;
  if (typeof auth.getUser !== "function") {
    throw new ValidationError("Firebase Admin user lookup is unavailable");
  }
  if (!isTransactionalFirestore(firestore)) {
    throw new ValidationError(
      "a Firestore client with transactions is required",
    );
  }

  let user;
  try {
    user = await auth.getUser(uid);
  } catch {
    throw new ValidationError("no Firebase Authentication user has that UID");
  }
  if (user.disabled) {
    throw new ValidationError("that Firebase Authentication user is disabled");
  }

  // Audit events are written to the existing audit collection.
  const events: AuditEvent[] = [];
  const audit = new AuditLog({ write: (event) => void events.push(event) });
  const access = new AccessService({
    store: new FirestoreOperatorAccountStore(firestore, {
      collectionPrefix: options.collectionPrefix,
    }),
    audit,
    projects: { has: () => false },
  });

  let result: InitialAdminBootstrapResult;
  try {
    const outcome = await access.bootstrapInitialAdmin({
      uid: user.uid,
      ...(user.email ? { email: user.email } : {}),
      ...(user.displayName ? { displayName: user.displayName } : {}),
      emailVerified: user.emailVerified === true,
    });
    result =
      outcome === "created"
        ? { outcome, message: "initial administrator provisioned" }
        : { outcome, message: "this administrator was already provisioned" };
  } catch (error) {
    if (!(error instanceof BootstrapLockedError)) throw error;
    result = {
      outcome: "refused",
      message:
        "bootstrap is locked: an administrator already exists — grant access through Settings → Users & Access",
    };
  }

  const auditRepo = firestoreRepository<AuditEvent>(
    firestore,
    `${options.collectionPrefix ?? ""}audit_events`,
  );
  for (const event of events) await auditRepo.upsert(event);
  return result;
}
