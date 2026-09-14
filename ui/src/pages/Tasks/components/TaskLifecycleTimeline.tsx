import { StatusDot, Timestamp } from "../../../components/ui";
import type { TaskTimelineEntry } from "../taskTimeline";

export function TaskLifecycleTimeline({
  entries,
}: {
  entries: readonly TaskTimelineEntry[];
}) {
  return (
    <ol className="task-timeline" aria-label="Task lifecycle timeline">
      {entries.map((entry) => (
        <li className="task-timeline__item" key={entry.id}>
          <span className="task-timeline__rail" aria-hidden="true">
            <StatusDot status={entry.tone} />
          </span>
          <div className="task-timeline__content">
            <div className="task-timeline__heading">
              <strong>{entry.title}</strong>
              <Timestamp value={entry.timestamp} />
            </div>
            <p className="text-caption">{entry.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
