import { GlassCard } from "../../../components/primitives/GlassCard";
import { useI18n } from "../../../i18n";

interface WorkforceStatusCardProps {
  /** Derived from the real overview query — never a hardcoded "all systems operational". */
  connection: "connected" | "degraded";
}

/** Explains the connection state; the indicator itself lives in the top bar. */
export function WorkforceStatusCard({ connection }: WorkforceStatusCardProps) {
  const { t } = useI18n();
  const connected = connection === "connected";

  return (
    <GlassCard pad="md" className="workforce-status-card">
      <div className="workforce-status-card__head">
        <h3 className="workforce-status-card__title">{t("overview.statusTitle")}</h3>
      </div>
      <p className="workforce-status-card__description">
        {connected ? t("overview.statusConnected") : t("overview.statusDegraded")}
      </p>
    </GlassCard>
  );
}
