import { Skeleton } from '../../../components/ui';

export function OverviewLoadingState() {
  return (
    <div className="overview-loading-state" role="status" aria-live="polite" aria-label="Loading workforce overview">
      <div className="overview-loading-state__section overview-loading-state__header">
        <Skeleton variant="rect" width="120px" height="12px" />
        <Skeleton variant="rect" width="220px" height="28px" />
        <Skeleton variant="rect" width="100%" height="16px" />
      </div>

      <div className="overview-loading-state__grid">
        <div className="overview-loading-card">
          <Skeleton variant="rect" width="160px" height="14px" />
          <Skeleton variant="rect" width="130px" height="42px" style={{ marginTop: '0.75rem' }} />
          <Skeleton variant="rect" width="100%" height="12px" style={{ marginTop: '1rem' }} />
        </div>

        <div className="overview-loading-state__metrics">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="overview-loading-card overview-loading-state__metric-card">
              <Skeleton variant="rect" width="88px" height="12px" />
              <Skeleton variant="rect" width="70px" height="30px" style={{ marginTop: '0.75rem' }} />
              <Skeleton variant="rect" width="100%" height="12px" style={{ marginTop: '1rem' }} />
            </div>
          ))}
        </div>
      </div>

      <div className="overview-loading-state__section">
        <Skeleton variant="rect" width="180px" height="20px" />
        <div className="overview-loading-row-group">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="overview-loading-card overview-loading-state__summary-card">
              <Skeleton variant="rect" width="140px" height="12px" />
              <Skeleton variant="rect" width="90px" height="28px" style={{ marginTop: '0.75rem' }} />
              <Skeleton variant="rect" width="100%" height="12px" style={{ marginTop: '1rem' }} />
            </div>
          ))}
        </div>
      </div>

      <div className="overview-loading-state__section">
        <Skeleton variant="rect" width="180px" height="20px" />
        <div className="overview-loading-card overview-loading-state__activity-card">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="overview-loading-state__activity-row">
              <Skeleton variant="circle" width="12px" height="12px" />
              <div className="overview-loading-state__activity-copy">
                <Skeleton variant="rect" width="40%" height="12px" />
                <Skeleton variant="rect" width="75%" height="12px" style={{ marginTop: '0.5rem' }} />
                <Skeleton variant="rect" width="30%" height="12px" style={{ marginTop: '0.5rem' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default OverviewLoadingState;
