# Coding Standards

The rules below reflect what the codebase already does. Match the surrounding
code before introducing anything new.

## Language & modules

- **TypeScript strict mode**, everywhere. `tsc` is the type-correctness gate.
- **Backend** (`contracts/`, `core/`, `adapters/`, `agents/`, `control/`,
  `api/`, `functions/`, `tests/`): ESM with **`NodeNext`** resolution and
  explicit `.js` import specifiers (`import { x } from "./y.js"`).
- **UI** (`ui/`): ESM with **bundler** resolution; `.ts`/`.tsx` imports carry
  no extension.
- Prefer `type`-only imports (`import { type Foo }`) — `verbatimModuleSyntax`
  is on in the UI.
- No `any` unless there is a documented technical reason. `unknown` + a
  validator is the default at boundaries.

## Design rules

- **Contracts first.** Shared interfaces live in `contracts/` before
  implementation, so parallel work has a stable seam.
- **Composition, not inheritance, across layers.** Dependencies are injected
  through constructors; `core` knows nothing about `adapters`.
- **Validate at boundaries.** Pure validators live next to the types; systems
  reject malformed input with `ValidationError`/`WorkforceError` subclasses.
- **Fail closed.** Agents and the tool pipeline return structured failures
  (`AgentExecutionError`, `ToolExecutionResult`), never partial results.
- **Single writer.** Each entity lifecycle has exactly one owning system
  (`TaskSystem`, `WorkflowSystem`, ...).
- **Deny by default.** Permissions and authorization grant nothing implicitly.

## Errors

Use the existing hierarchy in `contracts/` (`WorkforceError` and its subclasses:
`ValidationError`, `NotFoundError`, `PermissionDeniedError`, `ProviderError`
family, ...) and the control-plane taxonomy in `control/errors.ts`
(`errorKind`). Do not throw bare `Error` from domain code. Never put secrets,
tokens, or credentials in an error message.

## Logging

Use `core/logging` (`createLogger(scope)`), not `console.*`, in new core code.
Log **structured metadata**, never string-concatenated blobs:

```ts
const log = createLogger("ProjectService");
log.info("Project created", { projectId, userId });
```

The logger redacts sensitive keys recursively. It also deliberately omits
passwords, tokens, API keys, secrets, and private credentials — do not rely on
redaction to compensate for logging them at all. Do not log prompt/response
content unless explicitly opting in.

## Events

Internal cross-module signals use the typed foundation in `core/events`
(`createEvent`, `InMemoryEventBus`, `EventPublisher`). Do **not** build ad-hoc
pub/sub. Audit-worthy events belong in the `AuditLog`, not the in-memory bus.

## UI

- Components are **typed, accessible, reusable, and theme-aware**. Use design
  tokens (`var(--color-*)`, `var(--space-*)`, ...) — never hardcode colors.
- Do not create page-specific duplicates of a shared primitive in
  `components/ui`; extend the primitive instead.
- Every interactive element has an accessible name; status/errors use
  `role="status"` / `role="alert"`.
- The UI never imports `firebase/firestore`, `core/`, or `control/`. It calls
  feature API clients only.

## Style & tooling

- Formatting: **Prettier** (`printWidth: 80`, double quotes, trailing commas,
  semicolons, `endOfLine: auto`). Run `npm run format`.
- Linting: **ESLint 9** (syntactic). Run `npm run lint` (root) / `npm run lint`
  (ui).
- Comments explain **why**, not what. Keep them short and accurate.
- Prefer small, single-purpose modules that mirror the existing directory
  conventions.

## Commits

Small, coherent commits with an imperative, scoped subject
(`feat(agents): ...`, `fix(ui): ...`). Never commit `.env`, keys, or
credentials (see [deployment-strategy.md](./deployment-strategy.md)).
