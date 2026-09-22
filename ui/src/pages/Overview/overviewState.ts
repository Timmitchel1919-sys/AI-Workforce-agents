export type OverviewState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'degraded'
  | 'error'
  | 'unauthorized';

export interface OverviewViewState {
  status: OverviewState;
  message?: string;
}
