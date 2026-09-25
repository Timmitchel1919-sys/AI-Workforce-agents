# ADR-0017: Isolated workspaces and read-only repository operations (EO-4.3)

- Status: Accepted
- Date: 2026-09-24

## Context

EO-4.2 made bounded, registered operations executable. To change software
projects, agents need controlled file access and repository inspection
without host-filesystem access, raw git, or any path from file edits to
commits and pushes.

## Decision

1. Workspace and repository operations are ordinary EO-4.2 registered
   operations (tools `workspace` and `repository`), invoked only through
   `ExecutionManager.invoke` → `ToolExecutionEngine` → a sandbox provider.
2. `WorkspaceRepositorySandbox` confines every operation to the configured
   repository root: canonical relative paths, realpath containment (symlink /
   junction safe), policy classes (secret, protected, generated, internal),
   capability and mode checks, size limits, optimistic hashes, atomic writes.
3. Delete is a separate capability; protected-path writes need an optional,
   policy-granted capability. Read-only sessions get read-only workspaces.
4. Git is read-only and hardened (fixed templates, pinned GIT_DIR, no system
   or global config, protocol.allow=never). No stage, commit, branch or push
   operation exists.
5. Sessions may be persistent (multi-operation). Each has a ChangeSet and a
   pre-existing-change baseline; rollback reverts only session-owned changes.
6. One expiring write lease per repository root; cleanup fails closed.

## Consequences

- Pre-existing user changes cannot be overwritten by agents.
- Private repositories are described by credential references only; remote
  acquisition waits for a secret broker (EO-4.4+).
- Adapter confinement is not OS isolation; untrusted builds still require an
  isolating provider (EO-4.4).
