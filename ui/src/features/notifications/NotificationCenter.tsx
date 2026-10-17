import { useMemo, useState } from "react";
import { Bell, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useApprovalQueue, useAuditTrail } from "../governance";
import { buildNotifications, NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationPriority } from "./notificationModel";

const categoryLabels: Record<NotificationCategory, string> = {
  project: "Project",
  execution: "Execution",
  approval: "Approval",
  security: "Security",
  deployment: "Deployment",
  system: "System health",
};

type Filter = "all" | NotificationCategory;
type PriorityFilter = "all" | NotificationPriority;

export default function NotificationCenter() {
  const navigate = useNavigate();
  const approvals = useApprovalQueue({ status: "requested" });
  const audit = useAuditTrail({});
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Filter>("all");
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const notifications = useMemo(() => buildNotifications(approvals.items, audit.items), [approvals.items, audit.items]);
  const visible = notifications.filter(
    (item) => (category === "all" || item.category === category) && (priority === "all" || item.priority === priority),
  );
  const loading = approvals.state === "loading" || audit.state === "loading";
  const unavailable = [approvals.state, audit.state].every((state) =>
    ["unauthenticated", "forbidden", "unavailable", "not_found"].includes(state),
  );

  return (
    <div className="notification-center">
      <button
        type="button"
        className="topbar__action-button topbar__secondary-action notification-center__trigger"
        aria-label={`Notifications${notifications.length > 0 ? ` (${notifications.length})` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={16} aria-hidden="true" />
        {notifications.length > 0 ? <span className="notification-center__count">{Math.min(notifications.length, 99)}</span> : null}
      </button>
      {open ? (
        <section className="notification-center__panel" role="dialog" aria-modal="false" aria-label="Smart notifications">
          <header className="notification-center__header">
            <div><strong>Notifications</strong><span>Control Plane events only</span></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close notifications">×</button>
          </header>
          <div className="notification-center__filters">
            <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as Filter)}>
              <option value="all">All</option>
              {NOTIFICATION_CATEGORIES.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}
            </select></label>
            <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as PriorityFilter)}>
              <option value="all">All</option><option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option>
            </select></label>
          </div>
          <div className="notification-center__body">
            {loading && notifications.length === 0 ? <p>Loading authorized events…</p> : null}
            {unavailable ? <p>NOT CONNECTED — no authorized notification source is available.</p> : null}
            {!loading && !unavailable && visible.length === 0 ? <p>No matching events.</p> : null}
            {visible.length > 0 ? <ul>{visible.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => { setOpen(false); navigate(item.route); }}>
                  <span className={`notification-center__priority notification-center__priority--${item.priority}`}>{item.priority}</span>
                  <strong>{item.title}</strong><span>{item.detail}</span>
                  <small>{categoryLabels[item.category]} · {new Date(item.occurredAt).toLocaleString()}</small>
                  <ExternalLink size={13} aria-hidden="true" />
                </button>
              </li>
            ))}</ul> : null}
          </div>
          <footer>Opening an item only navigates or applies UI context. Privileged actions still require authorization.</footer>
        </section>
      ) : null}
    </div>
  );
}

