# `adapters/firebase/`

Firebase infrastructure adapters. The **only** code in the repository that
references `firebase-admin` (an optional peer dependency, loaded lazily).

| File                             | Implements              | Notes                                                                                                                               |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `firebase-services.ts`           | —                       | `loadFirebaseConfig()` + `createFirebaseServices()`; the narrow `FirestoreLike` / `FirebaseAuthLike` / `FirebaseStorageLike` seams. |
| `firestore-repository.ts`        | `AsyncRepository<T>`    | one doc per entity; bridge to sync with `CachedRepository`.                                                                         |
| `firebase-operator-directory.ts` | `OperatorDirectory`     | verify Firebase ID token → `role` / `allowedProjects` claims → `OperatorPrincipal`; anything unverifiable → `null`.                 |
| `firestore-event-publisher.ts`   | `ControlEventPublisher` | fire-and-forget append to `control_events`; never throws.                                                                           |
| `firebase-object-store.ts`       | `ObjectStore`           | Firebase Storage; hands out signed URLs, never credentials.                                                                         |

Nothing in `core/` or `control/` imports this module — it is wired in at the
composition root (`api/`). See [`docs/firebase.md`](../../docs/firebase.md) and
[ADR-0011](../../docs/adr/0011-firebase-infrastructure.md).

## Testing

`tests/firebase-adapters.test.ts` exercises every adapter against hand-written
in-memory fakes of the seams — `firebase-admin` is never imported, `npm test`
stays offline. For a real end-to-end run, use the Firebase emulator
(`firebase emulators:start`) and point `FIRESTORE_EMULATOR_HOST` etc. at it.
