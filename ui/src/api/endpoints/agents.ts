import type { ApiClient } from "../client";
import type { AgentView, ControlCommandResult } from "../contracts";

export function listAgents(client: ApiClient) {
  return client.get<AgentView[]>("/agents").then((r) => r.data);
}

export function getAgent(client: ApiClient, agentId: string) {
  return client
    .get<AgentView>(`/agents/${encodeURIComponent(agentId)}`)
    .then((r) => r.data);
}

export interface AgentCommandInput {
  agentId: string;
  reason?: string;
}

export function disableAgent(client: ApiClient, input: AgentCommandInput) {
  return client
    .post<ControlCommandResult>("/commands/disable-agent", input)
    .then((r) => r.data);
}

export function enableAgent(client: ApiClient, input: AgentCommandInput) {
  return client
    .post<ControlCommandResult>("/commands/enable-agent", input)
    .then((r) => r.data);
}
