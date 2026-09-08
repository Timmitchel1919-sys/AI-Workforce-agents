import type { ApiClient } from "../client";
import type { ControlCommandResult, WorkflowView } from "../contracts";

export function listWorkflows(client: ApiClient) {
  return client.get<WorkflowView[]>("/workflows").then((r) => r.data);
}

export function getWorkflow(client: ApiClient, workflowId: string) {
  return client
    .get<WorkflowView>(`/workflows/${encodeURIComponent(workflowId)}`)
    .then((r) => r.data);
}

export interface WorkflowCommandInput {
  workflowId: string;
  reason?: string;
}

export function pauseWorkflow(client: ApiClient, input: WorkflowCommandInput) {
  return client
    .post<ControlCommandResult>("/commands/pause-workflow", input)
    .then((r) => r.data);
}

export function resumeWorkflow(client: ApiClient, input: WorkflowCommandInput) {
  return client
    .post<ControlCommandResult>("/commands/resume-workflow", input)
    .then((r) => r.data);
}

export function cancelWorkflow(client: ApiClient, input: WorkflowCommandInput) {
  return client
    .post<ControlCommandResult>("/commands/cancel-workflow", input)
    .then((r) => r.data);
}
