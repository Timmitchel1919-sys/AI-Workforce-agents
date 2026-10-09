# Parallel Development

Multiple agents may work at once, but only by respecting ownership boundaries.
The goal is that parallel lanes never edit the same file and never wait on each
other for a shared shape.

## 1. Define shared contracts before implementation

Any interface two lanes share is merged to the integration branch **first**:

- Domain types and validators → `contracts/`
- HTTP request/response shapes → `contracts/` (consumed by `api/` and `ui/`)
- Core system method signatures → `core/*` interfaces

Until the contract is agreed, lanes must not implement against a guess. This is
the rule in `AGENTS.md`: "Shared interfaces and contracts must be defined before
parallel implementation."

## 2. One lane = one branch = one worktree

```
git worktree add ../aw-lane-projects -b feature/projects-lane
```

Each lane works in its own worktree on its own branch. This avoids two agents
fighting over one working tree and lets each run its own build/test loop.
Suggested lane split for the foundation:

| Lane               | Owns                                                     |
| ------------------ | -------------------------------------------------------- |
| backend foundation | `core/logging`, `core/events`, `contracts/*`             |
| UI shell           | `ui/src/app`, `ui/src/auth`, `ui/src/notifications`      |
| design system      | `ui/src/components/ui`, `ui/src/styles`, `ui/src/themes` |
| docs               | `docs/**`                                                |

## 3. File ownership

- A lane owns the files it creates; it edits another lane's files only through
  the shared contract, and only after coordinating.
- If a change genuinely must span two lanes' files, split it: land the contract
  or interface change first, then both lanes consume it.
- Never leave the integration branch non-building between lane merges. Each lane
  is green (`typecheck`, `lint`, `test`, `build`) before it is merged.

## 4. Integration

- Rebase/merge `main` into the lane regularly; resolve conflicts in the lane,
  not on the integration branch.
- Merge in dependency order (contracts → core → adapters → control/api → ui).
- After each merge, run the full gate from the repo root and `ui/`:

```bash
# root
npm run check        # typecheck + lint + format + test
npm run build
# ui
cd ui && npm run build && npm test
```

## 5. Communication guarantees

- Announce the files a lane will touch before starting.
- Treat the compiled contract, not a chat message, as the source of truth.
- When in doubt, stop and confirm the seam rather than duplicating a type.
