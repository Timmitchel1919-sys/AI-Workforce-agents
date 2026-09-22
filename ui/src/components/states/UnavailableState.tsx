import type { ReactNode } from 'react';
import { ServerCog } from 'lucide-react';
import { Button } from '../ui';
import './States.css';

export interface UnavailableStateProps {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: ReactNode;
}

export function UnavailableState({
  title = 'Service unavailable',
  description = 'This Control Center capability is temporarily unavailable.',
  action,
  onRetry,
  retryLabel = 'Refresh',
  icon,
}: UnavailableStateProps) {
  const headingId = 'unavailable-state-title';

  return (
    <section className="state state--unavailable" aria-labelledby={headingId}>
      <div className="state__icon state__icon--danger" aria-hidden="true">
        {icon ?? <ServerCog size={28} />}
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

export default UnavailableState;
