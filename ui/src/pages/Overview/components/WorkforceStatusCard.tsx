import { GlassCard } from "../../../components/primitives/GlassCard";
import { StatusChip } from "../../../components/primitives/StatusChip";
import { useI18n } from "../../../i18n";

interface WorkforceStatusCardProps {
  /** Derived from the real overview query — never a hardcoded "all systems operational". */
  connection: "connected" | "degraded";
}

export function WorkforceStatusCard({ connection }: WorkforceStatusCardProps) {
  const { t } = useI18n();
  const connected = connection === "connected";

  return (
    <GlassCard pad="md" className="workforce-status-card">
      <div className="workforce-status-card__head">
        <h3 className="workforce-status-card__title">{t("overview.statusTitle")}</h3>
        <StatusChip tone={connected ? "success" : "warning"} pulse={connected}>
          {connected ? t("overview.liveData") : t("overview.partialData")}
        </StatusChip>
      </div>
      <p className="workforce-status-card__description">
        {connected ? t("overview.statusConnected") : t("overview.statusDegraded")}
      </p>
      <div className="workforce-status-card__content">
        <p className="workforce-status-card__label">{t("overview.currentState")}</p>
        <StatusChip tone={connected ? "running" : "warning"} pulse={connected}>
          {connected ? t("overview.connected") : t("overview.degraded")}
        </StatusChip>
      </div>
    </GlassCard>
  );
}
