# Deployment Strategy

The project deploys to a single Firebase project (`ai-workforce-agents`, see
`.firebaserc`). There is no staging environment configured yet.

## Targets

`firebase.json` defines three deployable targets:

| Target                        | Source                                     | Notes                                                                                                                         |
| ----------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Hosting**                   | `ui/dist`                                  | Serves the Control Center. SPA rewrite: all non-API paths → `/index.html`.                                                    |
| **Functions**                 | `.` (codebase `control-plane`, `nodejs22`) | `predeploy` runs `npm run functions:prepare` (build + manifest). API is reached at `/api/**`, rewritten to `controlPlaneApi`. |
| **Firestore / Storage rules** | `firestore.rules`, `storage.rules`         | Both **deny all** direct client access; the Admin SDK (server) is the only reader/writer.                                     |
| **Emulators**                 | auth/firestore/storage/ui                  | Local development only.                                                                                                       |

## Build

```bash
# Backend / functions
npm ci
npm run functions:prepare        # tsc build + functions manifest

# Frontend (must exist before `firebase deploy --only hosting`)
cd ui && npm ci && npm run build && cd ..
```

`npm run verify:production` performs the pre-deploy production checks.

## Deploy

```bash
firebase deploy --only functions,hosting,firestore:rules,storage
```

Only ever deploy a **validated** build: root `npm run check` and `npm run build`
green, `ui` `npm test` and `npm run build` green. If deployment is not yet
configured for an environment, document what remains — do not invent
configuration or create new Firebase projects.

## Configuration & secrets

- Never commit `.env`, `.env.*` (except `.env.example`), service-account JSON,
  private keys, or API keys. `.gitignore` already excludes them; keep it that way.
- Server-side secrets are read from the environment only:
  `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` (service account),
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. See the root `.env.example`.
- The UI receives **only public** values via `VITE_*` variables (Firebase web
  config, API base URL). The Firebase web config is client-safe; the Anthropic /
  OpenAI keys are **never** exposed to the browser.
- Missing required configuration must fail clearly (`ConfigurationError` /
  `ProviderConfigError`), never silently fall back to an insecure default.

## Local development

```bash
# Backend API locally (composition root)
npm run build
# Firebase emulators (auth/firestore/storage/ui)
firebase emulators:start

# UI dev server
cd ui && npm run dev
```

Point the UI at a local API origin with `VITE_API_BASE_URL` in `ui/.env.local`
(also git-ignored). In production `VITE_API_BASE_URL` is left empty so requests
stay same-origin behind the Hosting rewrite.
