import { ArrowRight } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, StatusBadge } from "../../../components/ui";
import type { ActivityStatus, OverviewSummaryCard } from "../overviewData";


interface OverviewActivityCardProps {
  item?: OverviewSummaryCard;
  title?: string;
  description?: string;
  content?: ReactNode;
  action?: ReactNode;
  value?: string;
  status?: ActivityStatus;
  linkTo?: string;
}

export function OverviewActivityCard({
  item,
  title,
  description,
  content,
  action,
  value,
  status,
  linkTo,
}: OverviewActivityCardProps) {
  const { t } = useI18n();
  const summary = item ?? {
    id: "summary",
    title: title ?? t("overview.operationalSummary"),
    detail: description ?? t("overview.operationalSummary"),
    value: value ?? "0",
    status: status ?? "active",
    linkTo,
  };

  const cardTitle = item?.title ?? title ?? summary.title;
  const cardDescription = item?.detail ?? description ?? summary.detail;
  const cardValue = item?.value ?? value ?? summary.value;
  const cardStatus = item?.status ?? status ?? summary.status;
  const cardLinkTo = item?.linkTo ?? linkTo;

  const cardContent = content ?? (
    <div className="overview-activity-card__content">
      <div className="overview-activity-card__value-row">
        <span className="overview-activity-card__value">{cardValue}</span>
        <StatusBadge status={cardStatus}>{t(`status.${cardStatus}`)}</StatusBadge>
      </div>
      <p className="overview-activity-card__detail">{cardDescription}</p>
    </div>
  );

  const cardAction = action ?? (cardLinkTo ? (
    <div className="overview-activity-card__footer">
      <Link to={cardLinkTo} className="overview-activity-card__link">
        {t("overview.openSection")}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  ) : null);

  return (
    <Card className="overview-activity-card" title={cardTitle}>
      {cardContent}
      {cardAction}
    </Card>
  );
}
