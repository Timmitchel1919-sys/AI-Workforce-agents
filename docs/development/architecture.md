# Development Architecture

AI Workforce OS is a TypeScript modular monolith. The actual dependency direction is not the simplified folder order in planning documents: contracts are dependency-free; core depends on contracts; agents depend on core/contracts; adapters implement contract ports; control depends on core/contracts and injected ports; API is the composition/HTTP boundary; UI communicates only through the Control Plane.

See `docs/architecture.md` for the detailed module map and ADRs under `docs/adr/` for decisions. New vendor SDKs belong in adapters or the API composition root, never core. The browser must not import Firebase Admin, Firestore, filesystem, shell, or deployment implementations.

Security boundaries:

- Firebase Auth establishes identity; an ACTIVE operator record establishes authorization.
- Roles map to deny-by-default capabilities in `contracts/control.ts`.
- Project access is an explicit allow-list or `"*"`.
- Commands are validated, authorized, policy/approval gated, executed, and audited server-side.
- Firestore and Storage are server-only from the browser perspective.
- Raw secrets never enter browser payloads, argv, receipts, or audit events; use secret references.

Shared contracts must be defined before implementations. Avoid circular imports and preserve ESM/NodeNext `.js` specifiers in backend TypeScript.
