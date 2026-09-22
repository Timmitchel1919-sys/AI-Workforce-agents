import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '../ui';
import './States.css';

export interface UnauthorizedStateProps {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  onReturn?: () => void;
  returnLabel?: string;
  icon?: ReactNode;
}

export function UnauthorizedState({
  title = 'Access restricted',
  description = 'You do not have permission to access this resource.',
  action,
  onReturn,
  returnLabel = 'Return to Overview',
  icon,
}: UnauthorizedStateProps) {
  const headingId = 'unauthorized-state-title';

  return (
    <section className="state state--unauthorized" aria-labelledby={headingId}>
      <div className="state__icon state__icon--warning" aria-hidden="true">
        {icon ?? <ShieldAlert size={28} />}
      </div>

      <div className="state__content">
        <h3 id={headingId} className="state__title">
          {title}
        </h3>
        {description ? <p className="state__description">{description}</p> : null}
      </div>

      {(action || onReturn) ? (
        <div className="state__actions">
          {onReturn ? (
            <Button type="button" onClick={onReturn} variant="secondary">
              {returnLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </section>
  );
}

export default UnauthorizedState;
