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

Project isolation: every program and workstream is owned by exactly one
project. Ownership is server-derived. A command that names a program,
workstream or project the operator may not access is denied (`forbidden`) or
reported as `not_found` — never resolved across project boundaries. A task
draft may **not** declare `projectId`, `programId` or `workstreamId`; those
fields are rejected (`invalid_request`) and derived from the command scope.

## Reads (WorkforceQueryService)

### `GET /api/software-factory[?projectId=…]`

200 → `SoftwareFactoryOverview`. With `projectId` only that project's programs
are returned; without it, the operator's accessible projects are scanned. A
`projectId` outside the operator's scope yields `{ "programs": [] }`.

```json
{
  "programs": [
    {
      "id": "...",
      "projectId": "...",
      "name": "...",
      "objective": "...",
      "status": "active",
      "workstreamIds": ["ws-1"],
      "taskCount": 3,
      "activeTaskCount": 2,
      "updatedAt": "iso"
    }
  ]
}
```

### `GET /api/software-factory/programs/:programId?projectId=…`

`projectId` is required (400 when missing or blank). 200 →
`SoftwareFactoryProgramDetail`:

```json
{
  "program": {
    "schemaVersion": 1,
    "id": "...",
    "projectId": "...",
    "name": "...",
    "objective": "...",
    "status": "active",
    "workstreams": ["ws-1"],
    "createdAt": "iso",
    "updatedAt": "iso"
  },
  "workstreams": [
    {
      "schemaVersion": 1,
      "id": "ws-1",
      "projectId": "...",
      "programId": "p-1",
      "name": "...",
      "objective": "...",
      "status": "active",
      "tasks": ["t-1"],
      "createdAt": "iso",
      "updatedAt": "iso"
    }
  ],
  "graph": {
    "nodes": [
      {
        "id": "t-1",
        "task": {/* redacted SoftwareFactoryTaskView */},
        "status": "created"
      }
    ],
    "edges": [{ "from": "t-1", "to": "t-2", "type": "blocking" }]
  },
  "routes": [
    {
      "taskId": "t-1",
      "code": "docker",
      "status": "routed|requires_provisioning|no_environment|unsupported|skipped",
      "detail": "..."
    }
  ]
}
```

404 `{ "error": { "message": "unknown program" } }` when the program does not
exist in that project scope.

`task` in the graph is a **redacted** `SoftwareFactoryTaskView`: id, type,
description, ownership ids, priority, status, errors, timestamps, objective,
requirements, dependencies, requiredCapabilities, environmentRequirements,
completionCriteria, riskClass. Task `input`, `metadata`, `output` and
`requiredPermissions` are never sent across the API.

## Writes (WorkforceCommandService, POST via `/api/commands/:name`)

Command results follow the existing `ControlCommandResult` shape (audit id,
correlation id, outcome, entity id, summary, payload).

### `create-program` `{ "projectId": string, "id": string, "name": string, "objective": string }`

Creates an `active` program owned by `projectId`. Rejects invalid ids
(ValidationError → 400), unknown projects and unauthorized project scopes.

### `create-workstream` `{ "projectId": string, "programId": string, "id": string, "name": string, "objective": string }`

404/409 when the program is unknown **in that project scope**; requires the
program to exist.

### `add-workstream-task` `{ "projectId": string, "programId": string, "workstreamId": string, "task": SoftwareFactoryTaskInput }`

- `SoftwareFactoryTaskInput` may declare EO-5.1 fields: `objective`,
  `requirements`, `dependencies`, `requiredCapabilities`,
  `environmentRequirements`, `modelRequirements`, `completionCriteria`,
  `riskClass`. It must not declare `projectId`, `programId` or
  `workstreamId`.
- Adds the task to the workstream, then re-validates the workstream DAG. A
  cycle →
  `ValidationError` (`invalid_request`, 400). No task is created on failure.
- The orchestrator stores the task; dispatch happens via `tick-software-factory`.

### `tick-software-factory` `{ "projectId": string, "programId": string }`

Advances one program: for each task whose dependencies are all `completed`,
dispatches it through the standard governed `Orchestrator` (permission checks,
approval gates — **no execution bypass**, EO-5.1). Tasks declaring environment
requirements must resolve to exactly one `ROUTED` environment first; every
other routing outcome (including more than one declared code) leaves the task
`created` and never dispatches. The resolved environment is attached to the
dispatched task as execution context. Idempotent when nothing is ready.

## Error kinds

Standard `errorKind` mapping (`invalid_request` 400, `unauthorized` 401,
`forbidden` 403, `not_found` 404, `invalid_state` 409, `command_failure` 500).
No stack traces are ever sent.

## Notes for implementers

- The UI must only rely on the shapes above. Do not leak full
  `EnvironmentCodeRoute` objects across the API.
- Command names above are the kebab-case keys in the `COMMAND_METHODS` map
  (`api/http-api.ts`); the command service method names mirror them.
- Programs, workstreams and execution aliases are durable Firestore documents
  (`software_factory_programs`, `software_factory_workstreams`,
  `software_factory_task_aliases`) carrying `schemaVersion: 1`. Documents
  without that version are rejected on hydrate rather than guessed.
- Dispatching through the orchestrator creates a new task id; the planned id is
  retained as an execution alias so dependencies and the graph stay stable.
- The Function runs with `maxInstances: 1` and `concurrency: 1` and reuses one
  hydrated runtime per warm instance. These repositories are single-writer:
  they are not safe for concurrent multi-instance dispatch.
