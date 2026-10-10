import type { ReactNode } from "react";
import { Badge, StatusBadge } from "../../../components/ui";
import { translateStatus, type Translate } from "../../../i18n";
import type { AgentListItem } from "../../../features/agents";
import {
  mapAdministrativeStatusToBadge,
  mapOperationalStateToBadge,
  resolveOperationalState,
} from "./agentStatus";

// Re-exported values live in ./agentStatus and are imported from there
// directly, so this file stays component-only and fast refresh stays correct.

/**
 * Both axes together, administrative first, because it is the one that decides
 * whether new work is permitted at all.
 */
export function AxisBadges({ agent, t }: { agent: AgentListItem; t: Translate }) {
  const state = resolveOperationalState(agent);
  const administrative = agent.specialist?.administrativeStatus;
  return (
    <div className="agent-axis-badges">
      {administrative ? (
        <StatusBadge status={mapAdministrativeStatusToBadge(administrative)}>
          {translateStatus(t, administrative)}
        </StatusBadge>
      ) : null}
      <StatusBadge status={mapOperationalStateToBadge(state)}>{translateStatus(t, state)}</StatusBadge>
    </div>
  );
}

export function PolicyBadgeList({
  values,
  variant,
  emptyLabel,
}: {
  values: string[];
  variant: "info" | "neutral" | "danger" | "success" | "warning";
  emptyLabel: string;
}) {
  if (values.length === 0) {
    return <span className="agent-row__muted">{emptyLabel}</span>;
  }
  return (
    <div className="agent-row__capabilities">
      {values.map((value) => (
        <Badge key={value} variant={variant}>
          {value}
        </Badge>
      ))}
    </div>
  );
}

export function LabelledValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="agent-detail-metadata__item">
      <span className="agent-detail-label">{label}</span>
      <strong>{children}</strong>
    </div>
  );
}
