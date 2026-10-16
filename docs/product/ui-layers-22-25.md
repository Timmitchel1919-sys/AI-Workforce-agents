# UI layers 22–25 — discovery and advisory assistance

- Layer 22: current-route recommendations are derived only from existing destinations visible to the backend-reported role. Recommendations navigate; they never execute.
- Layer 23: search supports categories, contextual ranking, recent searches, recent resources, previews and keyboard selection. Only route metadata is retained in account-scoped session storage.
- Layer 24: the command palette now groups permission-aware commands, recent usage, history, contextual suggestions and pin actions. It exposes no shell or arbitrary execution surface.
- Layer 25: the assistant surface is present but explicitly reports `NOT CONNECTED`. There is no authorized browser-facing Model Router endpoint, so the UI does not fabricate AI output. The stated boundary remains advisory-only.

Authoritative backend authorization continues to apply to every destination and action.
