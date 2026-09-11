import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../app/providers/apiContext";
import { tasksApi, queryKeys, parseResponse } from "../../api";
import type { TaskListFilters } from "../../api/endpoints/tasks";

export type { TaskListFilters };

export function useTasks(filters: TaskListFilters = {}) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.tasks.list(filters),
    queryFn: () =>
      tasksApi.listTasks(client, filters).then(parseResponse.taskPage),
  });
}

export function useTask(taskId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.tasks.detail(taskId ?? ""),
    queryFn: () =>
      tasksApi.getTask(client, taskId as string).then(parseResponse.task),
    enabled: Boolean(taskId),
  });
}
