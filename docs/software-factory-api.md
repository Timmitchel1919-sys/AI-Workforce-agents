# Software Factory API contract (EO-5.1)

Shared contract for the Software Factory Control Center module. The backend
(`api/` + `control/`) implements these routes; the frontend
(`ui/src/features/softwareFactory/`) consumes them. Shapes below are JSON;
types named `ProgramSummary`, `SoftwareFactoryProgramDetail`, etc. live in
`contracts/orchestration.ts`. All routes are under the API `basePath` (`/api`
in production, same-origin via the hosting `/api/**` rewrite).

AuthN: every route requires `Authorization: Bearer <Firebase ID token>`.
AuthZ (server-side, AUTHZ-1): `viewer` may read; `create-program`,
`create-workstream`, `add-workstream-task`, and `tick-software-factory`
require `operator` or `admin`. Capabilities are derived server-side — the UI
never sends a role.

## Reads (WorkforceQueryService)

### `GET /api/software-factory`
200 → `SoftwareFactoryOverview`:
```json
{ "programs": [ { "id": "...", "name": "...", "objective": "...",
  "status": "active", "workstreamIds": ["ws-1"], "taskCount": 3,
  "activeTaskCount": 2, "updatedAt": "iso" } ] }
```

### `GET /api/software-factory/programs/:programId`
200 → `SoftwareFactoryProgramDetail`:
```json
{ "program": { "id": "...", "name": "...", "objective": "...",
  "status": "active", "workstreams": ["ws-1"], "createdAt": "iso",
  "updatedAt": "iso" },
  "workstreams": [ { "id": "ws-1", "programId": "p-1", "name": "...",
    "objective": "...", "status": "active", "tasks": ["t-1"], "createdAt": "iso",
    "updatedAt": "iso" } ],
  "graph": { "nodes": [ { "id": "t-1", "task": { /* Task object */ },
    "status": "created" } ], "edges": [ { "from": "t-1", "to": "t-2",
    "type": "blocking" } ] },
  "routes": [ { "taskId": "t-1", "code": "docker",
    "status": "routed|requires_provisioning|no_environment|unsupported|skipped",
    "detail": "..." } ] }
```
404 `{ "error": { "message": "unknown program: <id>" } }` when the program does
not exist.

## Writes (WorkforceCommandService, POST via `/api/commands/:name`)

Command results follow the existing `ControlCommandResult` shape (audit id,
correlation id, outcome, entity id, summary, payload).

### `create-program`  `{ "id": string, "name": string, "objective": string }`
Creates an `active` program. Rejects invalid ids (ValidationError → 400).

### `create-workstream`  `{ "programId": string, "id": string, "name": string, "objective": string }`
404/409 when the program is unknown; requires the program to exist.

### `add-workstream-task`  `{ "workstreamId": string, "task": TaskDraft }`
- TaskDraft may declare EO-5.1 fields: `programId`, `workstreamId`,
  `objective`, `requirements`, `dependencies`, `requiredCapabilities`,
  `environmentRequirements`, `modelRequirements`, `completionCriteria`,
  `riskClass`.
- Adds the task to the workstream, then re-validates the workstream DAG. A
  cycle →
  `ValidationError` (`invalid_request`, 400). No task is created on failure.
- The orchestrator stores the task; dispatch happens via `tick-software-factory`.

### `tick-software-factory`
Advances every `active` workstream: for each task whose dependencies are all
`completed`, dispatches it through the standard governed `Orchestrator`
(permission checks, approval gates — **no execution bypass**, EO-5.1). Tasks
declaring environment requirements must route to a `ROUTED` environment
first; otherwise they stay `blocked` with an environment detail. Idempotent
when nothing is ready.

## Error kinds
Standard `errorKind` mapping (`invalid_request` 400, `unauthorized` 401,
`forbidden` 403, `not_found` 404, `invalid_state` 409, `command_failure` 500).
No stack traces are ever sent.

## Notes for implementers
- The UI must only rely on the shapes above. Do not leak full
  `EnvironmentCodeRoute` objects across the API.
- Command names above are the kebab-case keys in the `COMMAND_METHODS` map
  (`api/http-api.ts`); the command service method names mirror them.