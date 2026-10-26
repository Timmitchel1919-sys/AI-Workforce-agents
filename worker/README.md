# AI Workforce Execution Worker (R2)

A single Cloud Run service that pulls `ExecutionJob` documents from
Firestore, runs the governed tool action in an ephemeral workspace, and
writes the result back to Firestore. The Control Plane (Firebase
Function) is the ONLY producer of jobs; the worker is the ONLY consumer.

## Local dev run

```bash
# From repo root. Starts the Firestore emulator; worker binds to it.
npm run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  FIREBASE_PROJECT_ID=demo-ai-workforce \
  WORKER_ID=dev-worker \
  node dist/worker/index.js
```

## Cloud Run deployment — manual steps (NOT automated this turn)

Everything below is owner work. The code is ready to deploy; this
section is the exact sequence a human must run once.

### Prerequisites

- `gcloud` CLI authenticated against the `ai-workforce-agents` GCP project.
- Cloud Run API enabled: `gcloud services enable run.googleapis.com`
- Artifact Registry API enabled: `gcloud services enable artifactregistry.googleapis.com`
- (Optional, if using GCR) Container Registry API enabled.
- Dedicated service account `execution-worker@ai-workforce-agents.iam.gserviceaccount.com`
  with `roles/datastore.user` on the project (and nothing else).

### 1. Create the service account

```bash
gcloud iam service-accounts create execution-worker \
  --display-name="AI Workforce execution worker" \
  --project=ai-workforce-agents

gcloud projects add-iam-policy-binding ai-workforce-agents \
  --member="serviceAccount:execution-worker@ai-workforce-agents.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

### 2. Build and push the container

```bash
docker build \
  -t gcr.io/ai-workforce-agents/execution-worker:latest \
  -f worker/Dockerfile .

gcloud auth configure-docker
docker push gcr.io/ai-workforce-agents/execution-worker:latest
```

### 3. Deploy to Cloud Run (us-central1 — same region as the function)

```bash
gcloud run deploy execution-worker \
  --image=gcr.io/ai-workforce-agents/execution-worker:latest \
  --region=us-central1 \
  --platform=managed \
  --service-account=execution-worker@ai-workforce-agents.iam.gserviceaccount.com \
  --no-allow-unauthenticated \
  --min-instances=1 \
  --max-instances=1 \
  --concurrency=1 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=900 \
  --set-env-vars=FIREBASE_PROJECT_ID=ai-workforce-agents,WORKER_ID=prod-worker \
  --project=ai-workforce-agents
```

`--no-allow-unauthenticated` keeps the health endpoint private; only the
worker's own service account can hit it (Cloud Run's IAM-based auth).

### 4. Enable the production feature flag (DEFERRED to a later turn)

The Control Plane will not enqueue jobs until `EXECUTION_WORKER_ENABLED`
is set in the function environment. Leaving it unset is the fail-closed
default so a half-provisioned worker never silently receives traffic.

## Environment variables

| Variable                         | Default        | Purpose                                                          |
| -------------------------------- | -------------- | ---------------------------------------------------------------- |
| `PORT`                           | `8080`         | HTTP port for `GET /healthz`                                     |
| `WORKER_ID`                      | `worker-<pid>` | Identifier recorded on every lease                               |
| `LEASE_TTL_MS`                   | `60000`        | How long a worker holds a job lease                              |
| `IDLE_POLL_MS`                   | `2000`         | Poll interval when the queue is empty                            |
| `WORKER_PROJECT_ID`              | unset          | Optional per-project filter                                      |
| `FIREBASE_PROJECT_ID`            | —              | Required to construct Firestore client                           |
| `FIRESTORE_EMULATOR_HOST`        | —              | Point at emulator for dev runs                                   |
| `GOOGLE_APPLICATION_CREDENTIALS` | —              | Service-account key path (Cloud Run supplies this automatically) |

## Security posture

- **No inbound HTTP execution.** The worker never accepts a job via HTTP;
  it only polls Firestore. `/healthz` is the only route.
- **Least-privilege service account.** `datastore.user` only — no
  Secret Manager, no Admin SDK, no deploy roles.
- **Ephemeral workspace per job.** `EphemeralLocalWorkspaceManager`
  creates a per-run tmp dir and `rm -rf`s it on completion or crash.
- **Governed command policy.** `DEFAULT_COMMAND_POLICY` allowlists
  executable + argv shape + env; everything else is denied.
- **Secret redaction.** `BoundedProcessRunner` strips known-secret
  shapes from stdout/stderr before persistence.
- **Path confinement.** Every filesystem action resolves through
  `resolveWithinWorkspace`; `../`, absolute paths, drive letters, UNC,
  percent-encoded bytes, and null bytes all fail closed.
