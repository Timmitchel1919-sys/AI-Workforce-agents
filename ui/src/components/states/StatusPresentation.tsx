import { StatusBadge } from '../ui';

export type StatusPresentationState =
  | 'operational'
  | 'degraded'
  | 'offline'
  | 'unavailable'
  | 'pending'
  | 'active'
  | 'inactive';

export interface StatusPresentationProps {
  status?: StatusPresentationState;
  label?: string;
  className?: string;
}

const statusMap = {
  operational: 'online',
  degraded: 'idle',
  offline: 'offline',
  unavailable: 'blocked',
  pending: 'pending',
  active: 'running',
  inactive: 'idle',
} as const satisfies Record<StatusPresentationState, 'online' | 'idle' | 'offline' | 'pending' | 'running' | 'blocked'>;

export function StatusPresentation({
  status = 'operational',
  label,
  className,
}: StatusPresentationProps) {
  const mappedStatus = statusMap[status];
  const text = label ?? status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <StatusBadge status={mappedStatus} className={className}>
      {text}
    </StatusBadge>
  );
}

export default StatusPresentation;
