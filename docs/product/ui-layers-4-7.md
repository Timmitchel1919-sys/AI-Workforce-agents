# UI Layers 4–7: status and boundaries

These are product/UI delivery layers on the existing architecture. No new core
layer was added. Everything goes through the Control Plane, and the backend
stays authoritative.

## Layer 4: Workflow Studio (`/workflow-studio`)

- **Definitions:** `WorkflowDefinition` / `WorkflowVersion` (`contracts/workflow-definitions.ts`).
  - Persisted in the durable `ExecutionRecordStore`, which is Firestore `execution_records`; clients are denied by the rules.
  - A published version is create-only, carries a SHA-256 content hash and is never modified.
  - Restore copies an old version into a new draft revision.
- **Node kinds** are only those with a real backing capability: `trigger`, `agent_task`, `approval`, `terminal`.
  - `model`, `tool`, `condition`, `data`, `review` and `notification` are listed as unavailable, each with its reason.
- **Validation** runs on the server against the live agent and tool registries, on every save, publish and simulation. The client copy only gives hints. Credentials are refused, and unknown fields are dropped.
- **Execution modes:**

  | Mode | Status |
  |---|---|
  | Design | Available |
  | Validation | Available |
  | Simulation | Available. Pure read: no agent, model, tool or approval call. |
  | Dry run | **Not offered.** No side-effect-free path exists. |
  | Live execution | **Withheld.** Workflow run state is in memory in a runtime rebuilt per request, so a launched run would not be durable. |

- **Commands:** `save-workflow-draft`, `validate-workflow`, `publish-workflow`, `archive-workflow`, `restore-workflow-version`, `duplicate-workflow`.
  - `author_workflow` is held by operators and admins.
  - `publish_workflow` (publish and archive) is held by admins only.

## Layer 5: Software Factory pipeline

`GET /api/software-factory/pipeline` reports each stage of the pipeline with:

- a mode: `automated`, `manual`, `awaiting_approval`, `not_configured` or `unavailable`;
- the reason for that mode, derived from what this deployment actually composes.

Production today has no runner, Git connection or deploy adapter. Implementation, testing, build, pull request and deployment therefore report **unavailable**.

## Layer 6: Intelligence Control Center (`/intelligence`)

- The previous page showed hard-coded models and metrics, for example "ChurnPredictor 95%". It now reads only real records:
  - agents;
  - declared model profiles (`GET /api/intelligence/models`);
  - routing decisions;
  - the usage ledger;
  - the governance policy.
- Every rate shows its sample size `n`, and data with no observations is shown as "unknown", never as zero.
- Pricing and benchmarks are labelled "not declared" and "not measured".
- Recommendations are deterministic and evidence-backed. They are advisory and never change a policy.

## Layer 7: Mobile Command Center

- **Phone navigation:** a bottom tab bar (Home, Missions, Approvals, Command, More), a connection banner, and a PWA manifest with shortcuts.
  - The service-worker precache previously listed missing files, which broke the install; that list is fixed.
  - API responses are never cached.
- **`/command`:** typed or voice input (Web Speech API, only while the user holds a listening session) is interpreted deterministically into navigation or read intents.
  - Deploy, merge, delete, approve, rollback, push and "start pipeline" phrases never execute. They route to the Approval Center.
- **Lost device:** `POST /api/me/sessions/revoke` ("Sign out all devices" on the Profile page) does three things:
  - sets `sessionsValidAfter` on the operator account, so every earlier ID token is refused on its next request;
  - revokes Firebase refresh tokens;
  - records an audit and security event.
  - A web app cannot remotely wipe a phone; the UI says so.
- The branded 15-second splash was removed. `/` now redirects an authorized user, or shows the landing page behind a plain loading state.

## Not implemented / blocked

| Item | Status |
|---|---|
| Live and PC-independent cloud execution | **BLOCKED.** No cloud runner is registered, and workflow run state is not durable. A runner (for example Cloud Run Jobs) adds recurring cost and needs owner approval. |
| Pull requests / GitHub | **NOT IMPLEMENTED.** No GitHub adapter is configured. |
| Emergency lockdown, per-device session inventory, push notifications, routing-policy editor, agent builder | **NOT IMPLEMENTED** in this release. |
