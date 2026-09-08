# AI Workforce Control Center — frontend

React + TypeScript + Vite. A **separate application** in the repository. It talks
to the existing Control Plane **only** through its HTTP API — never Firestore,
never the Admin SDK, never `core/` or `control/` directly.

```
React UI  →  HTTP API (api/)  →  Query / Command services (control/)  →  Core  →  Firebase adapters
```

## Status

- **UI-1 (foundation)** — routing, typed API client, auth boundary, providers,
  placeholder pages.
- **UI-2 (design foundation)** — semantic design tokens, dark/light architecture,
  the reusable primitive library (`src/components/ui/`), layout primitives
  (`src/components/layout/`), the unified status/risk system, accessibility
  baseline. **No feature dashboards yet** (later phases).

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

The Firebase project is the existing one, `ai-workforce-agents`.
`VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_APP_ID` must be filled in from the
Firebase console.

## Design system (UI-2)

- **Tokens** — `src/styles/tokens.css`. Semantic only (`--color-surface`,
  `--space-md`, `--text-body`, `--radius-md`, `--shadow-sm`, `--duration-normal`).
  Theme via `data-theme` on `<html>` (`light` / `dark`) or OS preference;
  `ThemeProvider` (`src/theme/`) applies it and persists the choice.
- **Primitives** — `src/components/ui/`: Button/IconButton, Field + Input /
  Textarea / Select / Checkbox / Switch, Badge / StatusBadge / StatusDot /
  StatusIndicator / RiskBadge, Card / Divider, Tabs / Breadcrumb / Pagination,
  DataTable, Dialog / Drawer / Popover / Dropdown / Tooltip, ToastProvider +
  `useToast`, Alert / Skeleton / Spinner / LoadingOverlay / EmptyState /
  ErrorState, Metric / KeyValue / Identifier / Timestamp / Progress /
  ActivityItem. One icon vocabulary in `components/ui/icons.ts` (Lucide).
- **Status** — `src/lib/status.ts` maps every domain's status string to one
  descriptor (label + tone + colour var). Components never invent per-feature
  colour logic.
- **Layout** — `src/components/layout/`: PageContainer, PageHeader, Section,
  Toolbar, Stack, Inline, Grid.
- **Responsive** — breakpoints in `src/theme/breakpoints.ts`
  (768 / 1024 / 1280 / 1440) + `useMediaQuery` / `useBreakpointUp`.
- **Accessibility** — native controls, one visible `:focus-visible` ring,
  `role`/`aria-*` on composites, native `<dialog>` for modals (focus trap + Esc),
  `prefers-reduced-motion` honoured globally.

## Layout

| Path                     | Purpose                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/app/`               | `App`, `AppRoutes`, providers (`Theme`, `Query`, `Auth`, `Api`, `Toast`), central `routes.ts`      |
| `src/auth/`              | `AuthProvider` (Firebase Auth), `useAuth`, `RequireAuth`, `permissions` (UX-only RBAC)             |
| `src/api/`               | `createApiClient` (Bearer + correlation id + error normalization), typed endpoints, `contracts.ts` |
| `src/theme/`             | `ThemeProvider`, `useTheme`, breakpoints / media-query hooks                                       |
| `src/components/ui/`     | The design-system primitives + `icons.ts`                                                          |
| `src/components/layout/` | Structural layout primitives                                                                       |
| `src/layouts/`           | App shell (`ControlCenterLayout`, `Sidebar`, `Topbar`, `MobileNavigation`)                         |
| `src/pages/`             | One placeholder per route + `Login` + `NotFound`                                                   |
| `src/features/`          | Query/mutation hooks (only `system/` so far)                                                       |
| `src/lib/`               | `status.ts`, formatters, dates, `cn` / `cssVars`                                                   |
| `src/styles/`            | `reset.css`, `tokens.css`, `globals.css`, `components.css`                                         |
| `src/test/`              | `renderWithProviders`, stubs                                                                       |

Security: the UI is **not** an authorization boundary. `permissions.ts` only
hides actions the server would reject anyway; every command still goes to the
Control Plane, which enforces authorization, approval, project isolation, and
audit.
