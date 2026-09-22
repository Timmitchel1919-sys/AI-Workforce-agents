import type { ReactNode } from 'react';
import { Spinner } from '../ui';
import './States.css';

export type LoadingStateMode = 'compact' | 'standard' | 'full-content';

export interface LoadingStateProps {
  title?: ReactNode;
  description?: ReactNode;
  mode?: LoadingStateMode;
}

export function LoadingState({
  title = 'Loading',
  description,
  mode = 'standard',
}: LoadingStateProps) {
  const size = mode === 'compact' ? 'small' : 'medium';

  return (
    <div
      className={`state state--loading state--${mode}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="state__icon" aria-hidden="true">
        <Spinner size={size} />
      </div>

      <div className="state__content">
        <h3 className="state__title">{title}</h3>
        {description ? <p className="state__description">{description}</p> : null}
      </div>
    </div>
  );
}

export default LoadingState;
