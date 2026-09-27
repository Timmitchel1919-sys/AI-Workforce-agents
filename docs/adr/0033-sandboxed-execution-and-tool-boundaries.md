# ADR-0033: Sandboxed Execution & Tool Boundary Enforcements

## Context
With the Specialist Agent Workforce autonomously orchestrated (ADR-0032), we must implement strict security and workspace isolation boundaries to ensure agents do not corrupt projects, step on each other's changes, or access unauthorized scopes.

## Decision
We will implement "strict, project-specific sandboxes with explicit lease acquisitions."

1. **WriteScopeLeaseManager**: 
   A centralized `LeaseManager` will govern access to any project's workspace. Before an agent can write to a file or path, an explicit `WriteScopeLease` must be acquired for that session.
   - Leases have scopes (e.g. `["src/frontend/*"]`) to prevent agents from interfering with other domains.
   - Leases expire.
   - Attempting to execute a write operation on a workspace path without an active lease covering that path will result in an immediate `ExecutionDeniedError`.

2. **Sandbox Enforcement**:
   The `ExecutionManager` or a dedicated `WorkspaceAdapter` will intercept all `workspace.file.*` and `repository.*` operations. If `workspaceAccess` is `"write"`, the adapter will verify the `WriteScopeLease`.

## Consequences
- Operations are strictly bound to project sandboxes.
- Concurrent specialist agents can safely operate on different parts of the workspace.
- We fail closed: without an explicit lease, no write operations can proceed.
