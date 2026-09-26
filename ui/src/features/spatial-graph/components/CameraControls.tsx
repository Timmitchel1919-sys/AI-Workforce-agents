import { useI18n, type MessageKey } from "../../../i18n";
import type { CameraCommandKind } from "../lib/camera";

interface Props {
  hasSelection: boolean;
  onCamera: (kind: CameraCommandKind) => void;
  onReset: () => void;
}

const BUTTONS: ReadonlyArray<{ kind: CameraCommandKind | "reset"; label: MessageKey; text: string }> = [
  { kind: "fit", label: "spatial.toolbar.fit", text: "⤢" },
  { kind: "zoomIn", label: "spatial.toolbar.zoomIn", text: "+" },
  { kind: "zoomOut", label: "spatial.toolbar.zoomOut", text: "−" },
  { kind: "focus", label: "spatial.toolbar.focus", text: "◎" },
  { kind: "reset", label: "spatial.toolbar.reset", text: "⌂" },
  { kind: "orbitLeft", label: "spatial.toolbar.orbitLeft", text: "⟲" },
  { kind: "orbitRight", label: "spatial.toolbar.orbitRight", text: "⟳" },
  { kind: "orbitUp", label: "spatial.toolbar.orbitUp", text: "⤒" },
  { kind: "orbitDown", label: "spatial.toolbar.orbitDown", text: "⤓" },
  { kind: "panLeft", label: "spatial.toolbar.panLeft", text: "←" },
  { kind: "panRight", label: "spatial.toolbar.panRight", text: "→" },
  { kind: "panUp", label: "spatial.toolbar.panUp", text: "↑" },
  { kind: "panDown", label: "spatial.toolbar.panDown", text: "↓" },
];

/** Compact camera overlay that sits on the stage. Real, labelled buttons in DOM order after the canvas. */
export function CameraControls({ hasSelection, onCamera, onReset }: Props) {
  const { t } = useI18n();
  return (
    <div className="sg-camera" role="toolbar" aria-label={t("spatial.toolbar.cameraActions")}>
      {BUTTONS.map((b) => (
        <button
          key={b.kind}
          type="button"
          className="sg-btn sg-btn--icon"
          aria-label={t(b.label)}
          title={t(b.label)}
          disabled={b.kind === "focus" && !hasSelection}
          onClick={() => (b.kind === "reset" ? onReset() : onCamera(b.kind))}
        >
          <span aria-hidden="true">{b.text}</span>
        </button>
      ))}
    </div>
  );
}
