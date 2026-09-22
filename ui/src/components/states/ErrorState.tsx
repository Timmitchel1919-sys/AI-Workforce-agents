import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../ui';
import './States.css';

export interface ErrorStateProps {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  secondaryAction?: ReactNode;
  icon?: ReactNode;
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Try again',
  secondaryAction,
  icon,
}: ErrorStateProps) {
  const headingId = 'error-state-title';

  return (
    <section className="state state--error" role="alert" aria-labelledby={headingId}>
      <div className="state__icon state__icon--danger" aria-hidden="true">
        {icon ?? <AlertTriangle size={28} />}
      </div>

      <div className="state__content">
        <h3 id={headingId} className="state__title">
          {title}
        </h3>
        {description ? <p className="state__description">{description}</p> : null}
      </div>

      {(onRetry || secondaryAction) ? (
        <div className="state__actions">
          {onRetry ? (
            <Button type="button" onClick={onRetry} variant="primary">
              {retryLabel}
            </Button>
          ) : null}
          {secondaryAction}
        </div>
      ) : null}
    </section>
  );
}

export default ErrorState;
