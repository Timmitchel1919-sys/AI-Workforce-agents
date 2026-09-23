import { Badge, Card, StatusBadge } from "../../../components/ui";
import { useI18n } from "../../../i18n";

interface WorkforceStatusCardProps {
  /** Derived from the real overview query — never a hardcoded "all systems operational". */
  connection: "connected" | "degraded";
}

export function WorkforceStatusCard({ connection }: WorkforceStatusCardProps) {
  const { t } = useI18n();
  const connected = connection === "connected";

  return (
    <Card
      className="workforce-status-card"
      title={t("overview.statusTitle")}
      description={connected ? t("overview.statusConnected") : t("overview.statusDegraded")}
    >
      <div className="workforce-status-card__content">
        <div>
          <p className="workforce-status-card__label">{t("overview.currentState")}</p>
          <StatusBadge status={connected ? "online" : "pending"}>
            {connected ? t("overview.connected") : t("overview.degraded")}
          </StatusBadge>
        </div>
        <Badge variant={connected ? "success" : "warning"}>
          {connected ? t("overview.liveData") : t("overview.partialData")}
        </Badge>
      </div>
    </Card>
  );
}
