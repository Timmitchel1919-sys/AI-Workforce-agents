# UI layers 17–21 — contextual workspace

Implemented as presentation-only intelligence. None of these preferences grant capabilities or execute Control Plane actions.

- Layer 17: the workspace now adapts navigation and layout to the current authorized route.
- Layer 18: account-scoped session state tracks current/recent/pinned routes, open panels, layout preset and dashboard layout. Resource payloads and caller-controlled project identifiers are not persisted.
- Layer 19: the context rail only links to existing routes visible to the backend-reported role.
- Layer 20: standard, focus and split presets, a collapsible/resizable context inspector and browser full-screen control are available. Preferences remain responsive and keyboard accessible.
- Layer 21: Overview widgets can be shown, hidden, reordered, resized and reset. Widgets continue to render the authoritative Overview snapshot; layout state cannot change operational authority.

Known boundary: no project identifier is shown until an authorized project-resource response can supply it. Query-string values are deliberately ignored.
