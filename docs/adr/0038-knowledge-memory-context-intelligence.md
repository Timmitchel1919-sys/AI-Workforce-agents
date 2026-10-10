# ADR-0038: Knowledge, Memory & Context Intelligence

## Status

Accepted

## Context

Layer 3 assembles context per request from live sources; nothing remembered
decisions, execution history or project knowledge, and `core/knowledge/KnowledgeEngine.ts`
was a console-logging stub. The platform is private and single-user: only project isolation
applies, no tenancy.

## Audit — what existed and what was reused

| Existing | Use |
| --- | --- |
| Layer 3 `ContextSource` seam + `ContextEngine` precedence/budget/secret filtering | Memory plugs in as `MemoryContextSource`; no second context engine |
| `maskSecrets` / `containsSecret` | Write policy, assembler output, learner |
| `AuditLog` (+ `AuditEventType`) | One new event type `knowledge_event` (`data.operation` = `memory.created`, …) |
| Repository / hydrate-once write-through persistence | 7 new collections, allocated before the single hydrate pass |
| Onboarding `analyzeRepositoryEvidence` + `GitHubRepositoryReader` | Project discovery REUSES the stack analyzer and GitHub reader |
| Layer 5 `GovernedFileSystem` / `LocalGitOps` | Workspace file source (read-only) and git history (`log`, fixed arguments) |
| Layer 5 `GovernedTaskRuntime` | New `onFinished` hook = learning loop entry point |
| Control capabilities / `operatorCanAccessProject` | New `manage_knowledge` capability; reads need `view` + project access |
| Cost Center | Nothing to meter: this layer makes no model calls (see gaps) |
| `knowledge_items` repo + `KnowledgeContextSource` (Layer 3) | Kept as is (read view of curated notes) |

## Decision

DATA, KNOWLEDGE, MEMORY, CONTEXT and EXECUTION HISTORY are separate: a normalized
`MemoryRecord` (type, provenance, confidence, importance, status, version, retention,
freshness), a relationship graph, and context that is assembled per request and never stored.

- **Types**: SYSTEM, PROJECT, ARCHITECTURAL, USER_PREFERENCE, EXECUTION, AGENT, DOCUMENT.
  **Status**: DRAFT/ACTIVE/SUPERSEDED/ARCHIVED/REVOKED (only ACTIVE is retrieved by default).
  **Confidence**: VERIFIED/USER_CONFIRMED/SYSTEM_GENERATED/AGENT_GENERATED/INFERRED/UNVERIFIED.
- **Write policy** (`write-policy.ts`): users' explicit statements become ACTIVE/USER_CONFIRMED;
  agent and system findings for protected types are DRAFT candidates until a user confirms;
  hedged agent text, agent SYSTEM writes and inferred preferences are refused; EXECUTION memory
  is ACTIVE only with verified evidence; CRITICAL only by an explicit user; secrets are redacted
  (a memory that is only a secret is blocked).
- **Quality pipeline** in `MemoryService.create`: validate → classify (facets, retention) →
  deduplicate (hash + token Jaccard → reinforce, upgrade-only) → link (graph) → index → activate.
- **Versioning**: every change snapshots; critical/architectural content is never edited in place —
  `supersede` keeps the old record (SUPERSEDED, `supersededBy`/`supersedes` + SUPERSEDES edge).
  Critical/architectural/system memory cannot be deleted, only revoked (admin for critical).
- **Conflicts**: ACTIVE decision memories of one project that state different values for the
  same closed facet (hosting, database, framework, auth, theme) or are linked CONFLICTS_WITH are
  flagged, audited and surfaced in retrieval and the context package. Only a user resolves them.
- **Hybrid retrieval**: BM25 with synonym expansion, trigram similarity (pluggable
  `SemanticScorer`), project, task/tag, agent-role fit, importance, confidence, recency, and graph
  distance; each hit carries its signals and a plain-language "why retrieved". Authorization is
  enforced inside the engine (project scope, agents never see preferences or other agents' memory);
  denials are audited.
- **Context assembler**: sectioned, cited, budgeted package; mandatory high-importance security
  requirements first, then confirmed decisions, relevant knowledge, execution history, docs; both
  sides of a conflict are shown and flagged.
- **Ingestion**: path classification (no credentials/binaries/deps), markdown chunking with
  provenance and source hash, high-level code symbol indexing, git commits as low-authority
  history, project discovery/refresh via the onboarding analyzer. A changed source archives its old
  chunks and marks dependent knowledge POTENTIALLY_STALE; confirmed memory is never overwritten.
- **Learning loop**: `ExecutionLearner` (deterministic, no model) stores verified failures,
  verified completions, and DRAFT rule candidates for recurring failures; closes memory-usage
  feedback. Success without passing checks stores nothing.
- **Governance**: `KnowledgeAuditor` rules (suspicious creation, unauthorized/excessive retrieval,
  conflicts, low-confidence use, unusual modification) raised through the audit log; health metrics;
  retention sweep archives expired TEMPORARY memory and never deletes audit records.
- **Performance**: repositories are wrapped in a non-cloning write-through cache; the index is
  incremental; identical retrievals are cached until memory changes. 2,500 creates ≈ 0.6 s,
  search ≈ 20 ms.

## Known gaps (reported, not hidden)

- **No embedding model**: "semantic" search is keyword + trigram similarity + synonyms; a
  `SemanticScorer` port exists but no provider is wired, so embedding cost is not metered.
- **PDF text extraction is not available**: PDFs are accepted only as already-extracted text.
- **Facet conflict detection is a heuristic** over a small vocabulary; other contradictions are
  only found if linked CONFLICTS_WITH.
- **GitHub discovery** reads only allow-listed configuration files (the reader's limit); full
  documentation/code ingestion needs a registered local workspace, which production has none of.
- Agents cannot yet write AGENT memory through the agent loop (the service supports it).
- Auditor rules live in `KnowledgeAuditor`, not inside the Cost Center `RuleAuditor`.
- Critical deletion is refused outright rather than routed through the approval system.
