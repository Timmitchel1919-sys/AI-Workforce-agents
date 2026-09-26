import { useI18n, type MessageKey } from "../../../i18n";
import type { CameraCommandKind } from "../lib/camera";

interface Props {
  hasSelection: boolean;
  isolated: boolean;
  expanded: boolean;
  onCamera: (kind: CameraCommandKind) => void;
  onDeselect: () => void;
  onIsolateToggle: () => void;
  onExpandToggle: () => void;
  onReset: () => void;
}

const CAMERA_BUTTONS: ReadonlyArray<{ kind: CameraCommandKind; label: MessageKey; text: string }> = [
  { kind: "fit", label: "spatial.toolbar.fit", text: "⤢" },
  { kind: "zoomIn", label: "spatial.toolbar.zoomIn", text: "+" },
  { kind: "zoomOut", label: "spatial.toolbar.zoomOut", text: "−" },
  { kind: "orbitLeft", label: "spatial.toolbar.orbitLeft", text: "⟲" },
  { kind: "orbitRight", label: "spatial.toolbar.orbitRight", text: "⟳" },
  { kind: "orbitUp", label: "spatial.toolbar.orbitUp", text: "⤒" },
  { kind: "orbitDown", label: "spatial.toolbar.orbitDown", text: "⤓" },
  { kind: "panLeft", label: "spatial.toolbar.panLeft", text: "←" },
  { kind: "panRight", label: "spatial.toolbar.panRight", text: "→" },
  { kind: "panUp", label: "spatial.toolbar.panUp", text: "↑" },
  { kind: "panDown", label: "spatial.toolbar.panDown", text: "↓" },
];

export function GraphToolbar({
  hasSelection,
  isolated,
  expanded,
  onCamera,
  onDeselect,
  onIsolateToggle,
  onExpandToggle,
  onReset,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="sg-toolbar" role="toolbar" aria-label={t("spatial.toolbar.label")}>
      <div className="sg-toolbar__group" role="group" aria-label={t("spatial.toolbar.cameraActions")}>
        {CAMERA_BUTTONS.map((b) => (
          <button
            key={b.kind}
            type="button"
            className="sg-btn sg-btn--icon"
            aria-label={t(b.label)}
            title={t(b.label)}
            onClick={() => onCamera(b.kind)}
          >
            <span aria-hidden="true">{b.text}</span>
          </button>
        ))}
        <button
          type="button"
          className="sg-btn"
          disabled={!hasSelection}
          onClick={() => onCamera("focus")}
        >
          {t("spatial.toolbar.focus")}
        </button>
        <button type="button" className="sg-btn" onClick={onReset}>
          {t("spatial.toolbar.reset")}
        </button>
      </div>
      <div className="sg-toolbar__group" role="group" aria-label={t("spatial.toolbar.selectionActions")}>
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
    </div>
  );
}
