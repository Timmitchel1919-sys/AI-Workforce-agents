# Parallel Development

Use one Git worktree and `codex/` branch per independent lane. Before delegation, define shared contracts and file ownership. Two lanes must not edit the same files, generated artifacts, lockfile, route table, or shared contract concurrently.

Recommended lanes are contract/service, adapter/composition, UI, tests, and documentation. Integrate in dependency order: contracts → core/control → adapters/API → UI → end-to-end tests. Each lane records its base commit, commands run, failures, and files changed. Rebase or merge only after the owning lane is complete; resolve shared-file conflicts deliberately, never by overwriting another lane.

Secrets, production changes, deployment, IAM, and data migrations are never delegated without explicit authority.
