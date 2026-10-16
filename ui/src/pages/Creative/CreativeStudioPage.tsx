import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, FlipHorizontal, RotateCw } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import {
  ACCEPTED_IMAGE_TYPES,
  DEFAULT_SPEC,
  MAX_IMAGE_BYTES,
  MAX_OUTPUT_WIDTH,
  render,
  type EditSpec,
} from "../../features/creative/imageOps";
import { useI18n, type MessageKey } from "../../i18n";
import "../Operations/OperationsPage.css";

const STATUS = ["image_edit", "image_generate", "video_edit", "audio_edit", "script", "youtube", "assets"] as const;
const ASPECTS: { label: string; value: number | null }[] = [
  { label: "", value: null },
  { label: "1:1", value: 1 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "4:5", value: 4 / 5 },
];

/**
 * Creative Studio (UI Layer 9). The image editor renders the exact output to
 * a canvas in the browser and exports a real PNG. Capabilities that do not
 * exist yet are listed as such — nothing is simulated.
 */
export default function CreativeStudioPage() {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState<EditSpec | null>(null);
  const [error, setError] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    if (img && spec && canvas.current) render(canvas.current, img, img.naturalWidth, img.naturalHeight, spec);
  }, [img, spec]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setError(false);
    setExported(null);
    if (!f) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(f.type) || f.size > MAX_IMAGE_BYTES) return setError(true);
    const url = URL.createObjectURL(f);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setName(f.name.replace(/\.[^.]+$/, ""));
      setSpec(DEFAULT_SPEC(image.naturalWidth));
    };
    image.onerror = () => setError(true);
    image.src = url;
  };

  const update = (patch: Partial<EditSpec>) => setSpec((s) => (s ? { ...s, ...patch } : s));

  const exportPng = () => {
    const c = canvas.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}-edited.png`;
      a.click();
      URL.revokeObjectURL(url);
      // Reported from the produced blob, not from the button click.
      setExported(t("creativeStudio.exported", { name: `${name}-edited.png`, kb: Math.round(blob.size / 1024), w: c.width, h: c.height }));
    }, "image/png");
  };

  return (
    <PageContainer variant="wide">
      <PageHeader eyebrow={t("common.brand")} title={t("creativeStudio.title")} description={t("creativeStudio.description")} />
      <div className="ops-bento">
        <section className="ops-card ops-card--wide" aria-labelledby="cs-image">
          <h2 id="cs-image">{t("creativeStudio.image")}</h2>
          <label className="ops-field">
            <span>{t("creativeStudio.choose")}</span>
            <input type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} onChange={onFile} />
          </label>
          {error ? <p role="alert">{t("creativeStudio.invalid")}</p> : null}
          {spec ? (
            <>
              <div className="ops-filters">
                <button type="button" className="ui-button ghost" onClick={() => update({ rotation: (((spec.rotation + 90) % 360) as EditSpec["rotation"]) })}>
                  <RotateCw size={16} aria-hidden /> {t("creativeStudio.rotate")}
                </button>
                <button type="button" className="ui-button ghost" aria-pressed={spec.flip} onClick={() => update({ flip: !spec.flip })}>
                  <FlipHorizontal size={16} aria-hidden /> {t("creativeStudio.flip")}
                </button>
                <label className="ops-field">
                  <span>{t("creativeStudio.width")}</span>
                  <input type="number" min={16} max={MAX_OUTPUT_WIDTH} value={spec.width} onChange={(e) => update({ width: Number(e.target.value) || 16 })} />
                </label>
                <label className="ops-field">
                  <span>{t("creativeStudio.brightness")}</span>
                  <input type="range" min={0} max={200} value={spec.brightness} onChange={(e) => update({ brightness: Number(e.target.value) })} />
                </label>
                <label className="ops-field">
                  <span>{t("creativeStudio.contrast")}</span>
                  <input type="range" min={0} max={200} value={spec.contrast} onChange={(e) => update({ contrast: Number(e.target.value) })} />
                </label>
                <label className="ops-field">
                  <span>{t("creativeStudio.crop")}</span>
                  <select value={String(spec.cropAspect)} onChange={(e) => update({ cropAspect: e.target.value === "null" ? null : Number(e.target.value) })}>
                    {ASPECTS.map((a) => (
                      <option key={a.label || "none"} value={String(a.value)}>{a.label || t("creativeStudio.cropNone")}</option>
                    ))}
                  </select>
                </label>
                <label className="ops-field">
                  <span>{t("creativeStudio.grayscale")}</span>
                  <input type="checkbox" checked={spec.grayscale} onChange={(e) => update({ grayscale: e.target.checked })} />
                </label>
                <button type="button" className="ui-button primary" onClick={exportPng}>
                  <Download size={16} aria-hidden /> {t("creativeStudio.export")}
                </button>
              </div>
              <p className="ops-muted">{t("creativeStudio.previewNote")}</p>
              {exported ? <p role="status">{exported}</p> : null}
            </>
          ) : null}
          <canvas ref={canvas} style={{ maxWidth: "100%", height: "auto", display: spec ? "block" : "none", borderRadius: 12 }} />
        </section>
        <section className="ops-card" aria-labelledby="cs-caps">
          <h2 id="cs-caps">{t("creativeStudio.capabilities")}</h2>
          <ul className="ops-list">
            {STATUS.map((k) => (
              <li key={k}>{t(`creativeStudio.status.${k}` as MessageKey)}</li>
            ))}
          </ul>
        </section>
      </div>
    </PageContainer>
  );
}
