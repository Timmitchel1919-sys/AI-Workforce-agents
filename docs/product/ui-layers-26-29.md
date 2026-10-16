# UI Layers 26–29

- Layer 26 derives advisory navigation suggestions only from bounded, account-scoped session route counts. It sends no behavioral analytics externally.
- Layer 27 adds a reusable route-aware inspector for summary, status boundary, authorized relationships/actions, workspace history, saved views, and evidence boundaries. Resource data remains owned by authorized resource workspaces.
- Layer 28 stores recent routes, layout presets, route-only pins, and explicit saved views in session storage. Sensitive resource content is not retained.
- Layer 29 adds `/` for search, `I` for the inspector, `M` for the main workspace, and `[` for the previous authorized route. Shortcuts are disabled while typing or while a modal is open.

The inspector never invents status or evidence. Without an authorized Control Plane resource response it displays `NOT CONNECTED`.
