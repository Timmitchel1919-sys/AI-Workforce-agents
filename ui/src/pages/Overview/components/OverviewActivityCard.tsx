import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { GlassCard } from "../../../components/primitives/GlassCard";
import { StatusChip, type StatusTone } from "../../../components/primitives/StatusChip";
import { useI18n } from "../../../i18n";
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

const toneByStatus: Record<ActivityStatus, StatusTone> = {
  active: "running",
  running: "running",
  completed: "success",
  pending: "queued",
  failed: "blocked",
  paused: "idle",
};

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
  const cardStatus = (item?.status ?? status ?? summary.status) as ActivityStatus;
  const cardLinkTo = item?.linkTo ?? linkTo;

  const cardContent = content ?? (
    <div className="overview-activity-card__content">
      <div className="overview-activity-card__value-row">
        <span className="overview-activity-card__value">{cardValue}</span>
        <StatusChip tone={toneByStatus[cardStatus] ?? "neutral"}>
          {t(`status.${cardStatus}`)}
        </StatusChip>
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
    <GlassCard pad="md" className="overview-activity-card">
      <h3 className="overview-activity-card__title">{cardTitle}</h3>
      {cardContent}
      {cardAction}
    </GlassCard>
  );
}
