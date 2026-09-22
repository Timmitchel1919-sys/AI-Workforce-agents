import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../auth/useAuth';
import type { OverviewState } from '../../../pages/Overview/overviewState';
import { getOverviewSnapshot, OverviewClientError } from '../api/overviewClient';
import type { OverviewSnapshot } from '../api/overviewTypes';

export interface UseOverviewResult {
  data?: OverviewSnapshot;
  status: OverviewState;
  error?: OverviewClientError;
  refetch: () => Promise<unknown>;
}

export function useOverview(): UseOverviewResult {
  const { accessToken } = useAuth();

  const query = useQuery({
    queryKey: ['overview', accessToken ?? 'anonymous'],
    queryFn: () => getOverviewSnapshot(accessToken),
    retry: false,
    staleTime: 30_000,
  });

  if (query.isLoading && !query.data) {
    return {
      status: 'loading',
      refetch: query.refetch,
    };
  }

  if (query.error instanceof OverviewClientError) {
    if (query.error.code === 'UNAUTHORIZED') {
      return {
        data: query.data,
        status: 'unauthorized',
        error: query.error,
        refetch: query.refetch,
      };
    }

    if (query.error.code === 'DEGRADED') {
      return {
        data: query.data,
        status: 'degraded',
        error: query.error,
        refetch: query.refetch,
      };
    }

    return {
      data: query.data,
      status: 'error',
      error: query.error,
      refetch: query.refetch,
    };
  }

  if (query.data) {
    if (query.data.metrics.length === 0 && query.data.summaryCards.length === 0 && query.data.activity.length === 0) {
      return {
        data: query.data,
        status: 'empty',
        refetch: query.refetch,
      };
    }

    return {
      data: query.data,
      status: 'ready',
      refetch: query.refetch,
    };
  }

  return {
    status: 'loading',
    refetch: query.refetch,
  };
}
