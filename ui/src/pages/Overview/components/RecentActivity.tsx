import { Link } from "react-router-dom";
import { Card, StatusBadge } from "../../../components/ui";
import type { ActivityStatus, ActivityType, RecentActivityItem } from "../overviewData";

const activityTypeLabel: Record<ActivityType, string> = {
  agent: "Agent",
  task: "Task",
  workflow: "Workflow",
  approval: "Approval",
  system: "System",
};

const activityStatusLabel: Record<ActivityStatus, string> = {
  active: "Active",
  completed: "Completed",
  running: "Running",
  pending: "Pending",
  failed: "Failed",
  paused: "Paused",
};

interface RecentActivityProps {
  items: RecentActivityItem[];
}

export function RecentActivity({ items }: RecentActivityProps) {
  return (
    <Card className="recent-activity" title="Recent activity" description="Latest operational updates across the workspace">
      <ul className="recent-activity__list" aria-label="Recent activity list">
        {items.map((item) => {
          const content = (
            <>
              <div className="recent-activity__header">
                <div className="recent-activity__meta-row">
                  <span className="recent-activity__type">{activityTypeLabel[item.type]}</span>
                  {item.actor ? <span className="recent-activity__actor">{item.actor}</span> : null}
                </div>
                <StatusBadge status={item.status}>{activityStatusLabel[item.status]}</StatusBadge>
              </div>

              <h3 className="recent-activity__title">{item.title}</h3>
              <p className="recent-activity__description">{item.description}</p>

              {(item.project || item.actor) && (
                <div className="recent-activity__details" aria-label={`${item.title} details`}>
                  {item.project ? <span>{item.project}</span> : null}
                </div>
              )}
            </>
          );

          return (
            <li key={item.id} className="recent-activity__item">
              <div className="recent-activity__content">
                {item.linkTo ? (
                  <Link to={item.linkTo} className="recent-activity__link" aria-label={`${item.title} - ${activityTypeLabel[item.type]}`}>
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
