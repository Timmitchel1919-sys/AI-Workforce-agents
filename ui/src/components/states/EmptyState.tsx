import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import './States.css';

export interface EmptyStateProps {
  title?: ReactNode;
  description?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({
  title = 'No items yet',
  description,
  primaryAction,
  secondaryAction,
  icon,
}: EmptyStateProps) {
  const headingId = 'empty-state-title';

  return (
    <section className="state state--empty" aria-labelledby={headingId}>
      <div className="state__icon" aria-hidden="true">
        {icon ?? <Inbox size={28} />}
      </div>

      <div className="state__content">
        <h3 id={headingId} className="state__title">
          {title}
        </h3>
        {description ? <p className="state__description">{description}</p> : null}
      </div>

      {(primaryAction || secondaryAction) ? (
        <div className="state__actions">
          {primaryAction}
          {secondaryAction}
        </div>
      ) : null}
    </section>
  );
}

export default EmptyState;
