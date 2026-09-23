import { Link } from "react-router-dom";
import { useI18n } from "../../../i18n";
import { Card, StatusBadge } from "../../../components/ui";
import type { RecentActivityItem } from "../overviewData";

interface RecentActivityProps {
  items: RecentActivityItem[];
}

export function RecentActivity({ items }: RecentActivityProps) {
  const { t } = useI18n();
  return (
    <Card className="recent-activity" title={t("overview.recentActivity")} description={t("overview.recentActivityCard")}>
      <ul className="recent-activity__list" aria-label={t("overview.recentActivityList")}>
        {items.map((item) => {
          const content = (
            <>
              <div className="recent-activity__header">
                <div className="recent-activity__meta-row">
                  <span className="recent-activity__type">{t(`overview.activityType.${item.type}`)}</span>
                  {item.actor ? <span className="recent-activity__actor">{item.actor}</span> : null}
                </div>
                <StatusBadge status={item.status}>{t(`status.${item.status}`)}</StatusBadge>
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
    </Card>
  );
}
