import Sidebar from "../../../components/layout/Sidebar";
import PageHeader from "../../../components/layout/PageHeader";
import { Skeleton } from "../../../components/ui";
import { PresentationNote, Reveal, SectionHeading } from "./primitives";
import { useI18n } from "../../../i18n";

// Skeleton's built-in fill is light-only; match the dark theme inside the preview.
const placeholder = { background: "var(--color-surface-muted)" };
const previewInertProps = { inert: "" };

/**
 * A non-interactive preview built from the real Control Center components
 * (Sidebar, PageHeader, Skeleton) in the app's dark theme. Content blocks are
 * placeholders on purpose — the product shows data from the Control Plane.
 */
export function CommandCenterPreview() {
  const { t } = useI18n();
  return (
    <section className="lp-section" aria-labelledby="lp-preview-title">
      <SectionHeading
        id="lp-preview-title"
        eyebrow={t("landing.preview.eyebrow")}
        title={t("landing.preview.title")}
        lead={t("landing.preview.lead")}
      />

      <Reveal className="lp-preview">
        <div className="lp-preview__window lp-glass">
          <div className="lp-preview__chrome" aria-hidden="true">
            <span />
            <span />
            <span />
            <p>{t("landing.preview.windowTitle")}</p>
          </div>

          <div
            className="lp-preview__app"
            data-theme="dark"
            {...previewInertProps}
            aria-label={t("landing.preview.label")}
            role="img"
          >
            <div className="lp-preview__sidebar">
              <Sidebar />
            </div>
            <div className="lp-preview__main">
              <PageHeader
                eyebrow={t("common.brand")}
                title={t("overview.title")}
                description={t("overview.description")}
              />
              <div className="lp-preview__cards">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="lp-preview__card">
                    <Skeleton height={12} width="55%" style={placeholder} />
                    <Skeleton height={26} width="30%" style={placeholder} />
                  </div>
                ))}
              </div>
              <div className="lp-preview__table">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="lp-preview__row">
                    <Skeleton height={12} width="34%" style={placeholder} />
                    <Skeleton height={12} width="16%" style={placeholder} />
                    <Skeleton height={12} width="20%" style={placeholder} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      <PresentationNote>{t("landing.preview.note")}</PresentationNote>
    </section>
  );
}

export default CommandCenterPreview;
