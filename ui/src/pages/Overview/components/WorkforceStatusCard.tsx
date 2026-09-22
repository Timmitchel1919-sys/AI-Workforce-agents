import { Badge, Card, StatusBadge } from "../../../components/ui";

interface WorkforceStatusCardProps {
  title?: string;
  description?: string;
  statusLabel?: string;
  statusTone?: "online" | "idle" | "pending" | "failed";
}

export function WorkforceStatusCard({
  title = "Workforce Status",
  description = "All core systems are operating normally.",
  statusLabel = "Operational",
  statusTone = "online",
}: WorkforceStatusCardProps) {
  return (
    <Card className="workforce-status-card" title={title} description={description}>
      <div className="workforce-status-card__content">
        <div>
          <p className="workforce-status-card__label">Current state</p>
          <StatusBadge status={statusTone}>{statusLabel}</StatusBadge>
        </div>
        <Badge variant="success">Control Plane stable</Badge>
      </div>
    </Card>
  );
}
