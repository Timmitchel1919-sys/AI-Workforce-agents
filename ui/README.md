# AI Workforce Control Center — frontend (UI-1)

React + TypeScript + Vite. A **separate application** in the repository. It talks
to the existing Control Plane **only** through its HTTP API — never Firestore,
never the Admin SDK, never `core/` or `control/` directly.

```
React UI  →  HTTP API (api/)  →  Query / Command services (control/)  →  Core  →  Firebase adapters
```

## Status: UI-1 (foundation)

Architecture, routing, the typed API client, the auth boundary, providers, and
placeholder pages. **No visual design** (UI-2) and **no feature dashboards**
(later). Every route renders a placeholder that proves the wiring.

## Commands

```bash
npm install
npm run dev          # Vite dev server (proxies /api → VITE_API_PROXY_TARGET)
npm run build        # typecheck + production build
npm run preview
npm run typecheck
npm run lint
npm run test         # Vitest + React Testing Library
npm run check        # typecheck + lint + format:check + test
```

## Environment

Copy `.env.example` → `.env.local` (gitignored). Only `VITE_*` values, all
public — the Firebase **web** config and the API base URL. **Never** put a
service-account key, Admin credentials, or an Anthropic/OpenAI key here: `VITE_*`
is embedded in the browser bundle. Server secrets live in the repo-root `.env`.

The Firebase project is the existing one, `ai-workforce-agents`. `VITE_FIREBASE_API_KEY`
and `VITE_FIREBASE_APP_ID` must be filled in from the Firebase console.

## Layout

| Path             | Purpose                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| `src/app/`       | `App`, `AppRoutes`, providers (`Query`, `Auth`, `Api`), central `routes.ts` |
| `src/auth/`      | `AuthProvider` (Firebase Auth), `useAuth`, `RequireAuth`, `permissions` (UX-only RBAC) |
| `src/api/`       | `createApiClient` (Bearer + correlation id + error normalization), typed endpoint modules, `contracts.ts` (re-exports backend view types) |
| `src/layouts/`   | `ControlCenterLayout`, `Sidebar`, `Topbar`, `MobileNavigation`        |
| `src/pages/`     | One placeholder per route + `Login` + `NotFound`                      |
| `src/features/`  | Query/mutation hooks (only `system/` in UI-1)                         |
| `src/components/`| `ui/`, `feedback/`, `status/` primitives; other folders are stubs for later |
| `src/lib/`       | formatters, dates, `cn`                                               |
| `src/styles/`    | `reset.css`, `tokens.css` (provisional), `globals.css`               |
| `src/test/`      | `renderWithProviders`, stubs                                         |

Security: the UI is **not** an authorization boundary. `permissions.ts` only
hides actions the server would reject anyway; every command still goes to the
Control Plane, which enforces authorization, approval, project isolation, and
audit.
