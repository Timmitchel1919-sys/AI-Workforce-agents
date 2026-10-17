import { Link } from "react-router-dom";
import { useI18n } from "../../../i18n";
import { DataPanel } from "../../../components/primitives/DataPanel";
import { StatusChip, type StatusTone } from "../../../components/primitives/StatusChip";
import type { ActivityStatus, RecentActivityItem } from "../overviewData";

interface RecentActivityProps {
  items: RecentActivityItem[];
}

const toneByStatus: Record<ActivityStatus, StatusTone> = {
  active: "running",
  running: "running",
  completed: "success",
  pending: "queued",
  failed: "blocked",
  paused: "idle",
};

export function RecentActivity({ items }: RecentActivityProps) {
  const { t } = useI18n();
  return (
    <DataPanel className="recent-activity">
      <div className="recent-activity__head">
        <h3 className="recent-activity__title-head">{t("overview.recentActivity")}</h3>
        <p className="recent-activity__description-head">{t("overview.recentActivityCard")}</p>
      </div>
      <ul className="recent-activity__list" aria-label={t("overview.recentActivityList")}>
        {items.map((item) => {
          const content = (
            <>
              <div className="recent-activity__header">
                <div className="recent-activity__meta-row">
                  <span className="recent-activity__type">{t(`overview.activityType.${item.type}`)}</span>
                  {item.actor ? <span className="recent-activity__actor">{item.actor}</span> : null}
                </div>
                <StatusChip tone={toneByStatus[item.status] ?? "neutral"}>
                  {t(`status.${item.status}`)}
                </StatusChip>
              </div>

              <h3 className="recent-activity__title">{item.title}</h3>
              <p className="recent-activity__description">{item.description}</p>

              {(item.project || item.actor) && (
                <div className="recent-activity__details" aria-label={t("overview.itemDetails", { title: item.title })}>
                  {item.project ? <span>{item.project}</span> : null}
                </div>
              )}
            </>
          );

          return (
            <li key={item.id} className="recent-activity__item">
              <div className="recent-activity__content">
                {item.linkTo ? (
                  <Link to={item.linkTo} className="recent-activity__link" aria-label={`${item.title} - ${t(`overview.activityType.${item.type}`)}`}>
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </div>
              <time className="recent-activity__time" dateTime={item.timestamp}>
                {item.timestamp}
              </time>
            </li>
          );
        })}
      </ul>
    </DataPanel>
  );
}
