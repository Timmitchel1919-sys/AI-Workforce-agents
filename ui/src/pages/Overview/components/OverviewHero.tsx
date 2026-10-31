import { Activity, ShieldCheck } from "lucide-react";
import { GlassPanel } from "../../../components/primitives/GlassPanel";
import { StatusChip } from "../../../components/primitives/StatusChip";
import { useI18n } from "../../../i18n";

/**
 * Operational header for the Overview. Replaces the legacy decorative
 * Earth + rotating emblem — this is an operating-system cockpit, not a brand
 * splash. Shows system identity, and posture; connection state lives in the top bar.
 */
export function OverviewHero() {
  const { t } = useI18n();

  return (
    <GlassPanel elevation="elevated" className="overview-hero" aria-labelledby="overview-hero-title">
      <div className="overview-hero__copy">
        <p className="overview-hero__kicker">
          <Activity size={12} aria-hidden /> {t("overview.heroKicker")}
        </p>
        <h2 id="overview-hero-title" className="overview-hero__title">
          {t("overview.heroTitle")}
        </h2>
        <p className="overview-hero__tagline">{t("overview.heroTagline")}</p>
        <p className="overview-hero__description">{t("overview.heroDescription")}</p>
      </div>
      <div className="overview-hero__meta">
        <StatusChip tone="neutral">
          <ShieldCheck size={10} aria-hidden style={{ marginRight: 4 }} />
          {t("overview.heroVerbs")}
        </StatusChip>
      </div>
    </GlassPanel>
  );
}

export default OverviewHero;
