import { useI18n } from "../../../i18n";

interface Props {
  hasSelection: boolean;
  isolated: boolean;
  expanded: boolean;
  onDeselect: () => void;
  onIsolateToggle: () => void;
  onExpandToggle: () => void;
}

/** Selection actions (observational only: they change the view, never the backend). */
export function GraphToolbar({ hasSelection, isolated, expanded, onDeselect, onIsolateToggle, onExpandToggle }: Props) {
  const { t } = useI18n();
  return (
    <div className="sg-toolbar" role="toolbar" aria-label={t("spatial.toolbar.selectionActions")}>
      <button type="button" className="sg-btn" disabled={!hasSelection} onClick={onDeselect}>
        {t("spatial.toolbar.deselect")}
      </button>
      <button
        type="button"
        className="sg-btn"
        disabled={!hasSelection && !isolated}
        aria-pressed={isolated}
        onClick={onIsolateToggle}
      >
        {isolated ? t("spatial.toolbar.exitIsolate") : t("spatial.toolbar.isolate")}
      </button>
      <button
        type="button"
        className="sg-btn"
        disabled={!hasSelection}
        aria-pressed={expanded}
        onClick={onExpandToggle}
      >
        {expanded ? t("spatial.toolbar.collapse") : t("spatial.toolbar.expand")}
      </button>
    </div>
  );
}
