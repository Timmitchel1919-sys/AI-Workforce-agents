import type { ReactNode } from 'react';
import { WifiOff } from 'lucide-react';
import { Button } from '../ui';
import './States.css';

export interface OfflineStateProps {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: ReactNode;
}

export function OfflineState({
  title = 'Connection unavailable',
  description = 'Some Control Center data may be temporarily unavailable.',
  action,
  onRetry,
  retryLabel = 'Retry connection',
  icon,
}: OfflineStateProps) {
  const headingId = 'offline-state-title';

  return (
    <section className="state state--offline" aria-labelledby={headingId}>
      <div className="state__icon state__icon--warning" aria-hidden="true">
        {icon ?? <WifiOff size={28} />}
      </div>

      <div className="state__content">
        <h3 id={headingId} className="state__title">
          {title}
        </h3>
        {description ? <p className="state__description">{description}</p> : null}
      </div>

      {(action || onRetry) ? (
        <div className="state__actions">
          {onRetry ? (
            <Button type="button" onClick={onRetry} variant="secondary">
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </section>
  );
}

export default OfflineState;
