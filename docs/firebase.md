# Firebase infrastructure (Phase 7B)

Firebase is an **infrastructure adapter** behind provider-neutral ports. The
Workforce core and the Control Plane never import `firebase-admin`.

```
        AI WORKFORCE UI  (Phase 7C — not built)
               │  HTTPS + Bearer token
               ▼
        api/  createControlPlaneApi         ← authN, correlation id, status mapping
               │
        control/  Query / Command services  ← authz, approval, project scope, audit
               │
        core/                                ← deterministic lifecycle
               │
        contracts/  Repository / AsyncRepository / OperatorDirectory /
               │    ControlEventPublisher / ObjectStore        (the ports)
               ▼
        adapters/firebase/                   ← the ONLY firebase-admin consumer
               │
     ┌─────────┼───────────────┐
     ▼         ▼               ▼
  Firestore   Firebase Auth   Firebase Storage
```

## Ports and adapters

| Contract port           | Firebase adapter (`adapters/firebase/`) | Backs                                                                     |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `AsyncRepository<T>`    | `FirestoreRepository<T>`                | one document per entity, keyed by `entity.id`                             |
| `OperatorDirectory`     | `FirebaseOperatorDirectory`             | verify ID token → `role` / `allowedProjects` claims → `OperatorPrincipal` |
| `ControlEventPublisher` | `FirestoreEventPublisher`               | append-only `control_events` collection                                   |
| `ObjectStore`           | `FirebaseObjectStore`                   | Firebase Storage bucket; UI gets signed URLs only                         |

`firebase-admin` is an **optional peer dependency**, loaded lazily by
`createFirebaseServices()`. `adapters/firebase/firebase-services.ts` is the only
module that references it; everything else works against the narrow seams
(`FirestoreLike`, `FirebaseAuthLike`, `FirebaseStorageLike`).

## Sync core, async store

`Repository<T>` is synchronous (ADR-0002) and every core system is built on it.
`FirestoreRepository` implements the async `AsyncRepository<T>`;
`CachedRepository` (`core/persistence/`) bridges the two:

```
hydrate() once  →  reads served from an in-memory copy  →  writes: cache now, Firestore on a queue
```

`CachedRepository` drops into the existing constructors unchanged
(`new AuditLog(sink, repo)`, `new AgentOperationalStore(repo)`, …). Call
`hydrateAll()` before serving traffic and `flushAll()` on shutdown. It assumes a
**single writer** — one process owns the cache; see ADR-0011 for the
multi-instance caveat.

## Environment

Read by the API composition root only (see `.env.example`):

| Variable                         | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`            | required (or `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT`)  |
| `GOOGLE_APPLICATION_CREDENTIALS` | path to a service-account JSON key — **never committed** |
| `FIREBASE_STORAGE_BUCKET`        | default `<projectId>.appspot.com`                        |
| `FIRESTORE_EMULATOR_HOST` etc.   | set to use the local emulator (no credentials)           |

## Security rules

`firestore.rules` and `storage.rules` are **deny-all** (`allow read, write: if
false`). The Admin SDK bypasses rules by design, so the Control Plane still has
full access — but no browser can read or write Firestore/Storage directly. Every
UI operation goes through the API.

## Wiring example (composition root)

```ts
import { createServer } from "node:http";
import {
  createFirebaseServices,
  FirebaseOperatorDirectory,
  FirestoreEventPublisher,
} from "./adapters/firebase/index.js";
import {
  FirebaseRepositoryProvider,
  createControlPlaneApi,
} from "./api/index.js";
import { AuditLog } from "./core/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceQueryService,
  WorkforceCommandService,
} from "./control/index.js";

const fb = await createFirebaseServices(); // reads env; lazy-loads firebase-admin

const repos = new FirebaseRepositoryProvider(fb.firestore, {
  onWriteError: (op, err) => console.error("firestore write failed", op, err),
});
const auditRepo = repos.repository("audit_events");
const agentOpsRepo = repos.repository("agent_operational");
const workflowControlRepo = repos.repository("workflow_control");
await repos.hydrateAll();

const audit = new AuditLog(undefined, auditRepo);
const agentOps = new AgentOperationalStore(agentOpsRepo);
const workflowControl = new WorkflowControlStore(workflowControlRepo);
const events = new FirestoreEventPublisher(
  fb.firestore.collection("control_events"),
);

// Build the rest of the ControlPlaneContext (agents, tasks, workflows,
// approvals, permissions, tools, projects, orchestrator, …) as your deployment
// requires — Firestore-backed via `repos.repository(...)`, or in-memory.
const ctx = {
  /* … */ audit,
  agentOps,
  workflowControl,
  events,
};

const query = new WorkforceQueryService(ctx);
const command = new WorkforceCommandService(ctx);
const operatorDirectory = new FirebaseOperatorDirectory(fb.auth);

const handler = createControlPlaneApi({ query, command, operatorDirectory });
createServer(handler).listen(8080);

process.on("SIGTERM", () => {
  void repos.flushAll();
});
```

## Local emulator

```bash
npm install -g firebase-tools     # one-time; needs Java
firebase emulators:start          # auth :9099  firestore :8080  storage :9199  ui :4000
# then run the composition root with FIRESTORE_EMULATOR_HOST=localhost:8080 …
```

`npm test` does **not** use the emulator — the adapters are unit-tested against
in-memory fakes and stay fully offline.

## HTTP API surface

`GET /api/health` (no auth) · `GET /api/status` · `/api/system-health` ·
`/api/dashboard` · `/api/agents[/:id]` · `/api/tasks[/:id]` (query filters) ·
`/api/workflows[/:id]` · `/api/approvals` · `/api/projects[/:id]` ·
`/api/tools[/:id]` · `/api/audit` (query filters).
`POST /api/commands/{approve|reject|cancel-task|retry-task|pause-workflow|resume-workflow|cancel-workflow|disable-agent|enable-agent}`.

Every non-health request needs `Authorization: Bearer <Firebase ID token>`.
`x-correlation-id` is honoured inbound and echoed outbound. Errors are
`{ "error": { "message": "…" } }` — never a stack trace; command results carry
`errorKind` and map to 400/401/403/404/409/422/500.
