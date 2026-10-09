# Branching Strategy

## Branches

| Pattern                 | Purpose                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `main`                  | Integration and release branch. Always builds and passes `npm run check`. |
| `feature/<slug>`        | One feature, fix, or lane. Short-lived. Merged to `main` via PR.          |
| `release/<tag>`         | Frozen, deployed revisions of `main`.                                     |
| `archive/<name>-<date>` | Snapshot of work that is being retired but kept for reference.            |
| `backup/<name>`         | Local safety snapshots. Never merged.                                     |

Examples in this repository: `feature/private-factory`,
`archive/enterprise-baseline-2026-10-06`, `backup/local-master`,
`release/eo5-only`.

## Flow

1. Branch from an up-to-date `main`:
   ```bash
   git switch main && git pull
   git switch -c feature/<slug>
   ```
2. Work in small, coherent commits. Keep the branch green.
3. Before pushing, run the full gate:
   ```bash
   npm run check          # root: typecheck + lint + format + test
   npm run build
   ( cd ui && npm run build && npm test )
   ```
4. Open a PR into `main`. The PR must include a summary, the validation
   performed, and an honest statement of what is `NOT IMPLEMENTED` if any part
   of the scope was deferred.
5. Squash or merge once CI is green and review is complete.

## Rules

- Never commit directly to `main` for feature work.
- Never force-push a shared branch.
- One logical change per PR; avoid mixing a large refactor with a feature.
- Do not commit generated output (`dist/`) or secrets (`.env`, keys) — see
  [deployment-strategy.md](./deployment-strategy.md).
- Retire superseded work to `archive/*` rather than deleting it outright when it
  documents a decision.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request,
against Node 20 and 22: `npm ci` → `typecheck` → `lint` → `format:check` →
`test` → `build`. It requires no secrets. The `ui/` app is validated by its own
scripts and should be checked in the same PR.
