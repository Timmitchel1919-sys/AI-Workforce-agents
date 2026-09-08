import { ChevronsUpDown, FolderKanban, Tooltip } from "../components/ui";

/**
 * Project/workspace context. The Control Plane does not yet expose a
 * project-switch capability, so this renders the current (single) context and
 * is inactive — the correct boundary for a future multi-project switcher.
 */
export function WorkspaceSwitcher() {
  return (
    <Tooltip content="Multi-project switching arrives in a later phase">
      <span
        className="workspace-switcher"
        role="button"
        aria-disabled="true"
        tabIndex={0}
      >
        <FolderKanban width={14} height={14} aria-hidden="true" />
        All projects
        <ChevronsUpDown width={13} height={13} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
