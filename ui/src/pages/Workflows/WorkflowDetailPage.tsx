import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isApiError } from "../../api";
import { PageFrame, Section, Stack } from "../../components/layout";
import {
  Alert,
  Button,
  ErrorState,
  Skeleton,
  StatusBadge,
} from "../../components/ui";
import { ChevronLeft } from "../../components/ui/icons";
import { useWorkflow } from "../../features/workflows";
import { useAuth } from "../../auth/useAuth";
import { useTasks } from "../../features/tasks";
import { useAuditEvents } from "../../features/audit";
import { pairExecutions } from "../Agents/executions";
import {
  WorkflowContextCard,
  WorkflowGovernanceCard,
  WorkflowApprovalSummary,
  WorkflowAuditSummary,
  WorkflowProvenanceCard,
  WorkflowDetailHeader,
  WorkflowExecutionSummary,
  WorkflowGraph,
  WorkflowNodeDetails,
  WorkflowRuntimeCard,
  WorkflowRuntimeEvents,
  WorkflowOverviewCard,
  WorkflowOperations,
  WorkflowParticipantsCard,
  WorkflowStepExecutions,
  WorkflowTriggerCard,
  toWorkflowGraph,
} from "./components";
import { runtimeEvents, toWorkflowStepExecutions } from "./workflowRuntime";
import "./WorkflowDetailPage.css";

const BACK = (
  <Link to="/workflows" className="link ui-inline" style={{ gap: 4 }}>
    <ChevronLeft width={16} height={16} aria-hidden="true" />
    Back to Workflows
  </Link>
);

/**
 * Read-only workflow intelligence. All data is returned by `useWorkflow`; the
 * page never loads task history, execution logs, or graph definitions.
 */
export function WorkflowDetailPage() {
  const { role, allowedProjects } = useAuth();
  const { workflowId } = useParams();
  const query = useWorkflow(workflowId);
  const taskQuery = useTasks({ workflowId, limit: 100 });
  const auditQuery = useAuditEvents({ workflowId, limit: 50 });
  const workflow = query.data;
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const graph = useMemo(
    () =>
      workflow
        ? toWorkflowGraph(
            workflow,
            taskQuery.data?.items ?? [],
            taskQuery.data ? taskQuery.data.nextCursor === null : true,
          )
        : undefined,
    [taskQuery.data, workflow],
  );
  const executions = useMemo(() => {
    const currentTaskId =
      workflow?.status === "running"
        ? taskQuery.data?.items.find(
            (task) => task.workflowSpecId === workflow.currentSpecId,
          )?.taskId
        : undefined;
    return pairExecutions(auditQuery.data?.items ?? [], currentTaskId);
  }, [
    auditQuery.data,
    taskQuery.data,
    workflow?.currentSpecId,
    workflow?.status,
  ]);
  const stepExecutions = useMemo(
    () =>
      workflow
        ? toWorkflowStepExecutions(
            workflow,
            taskQuery.data?.items ?? [],
            executions,
          )
        : [],
    [executions, taskQuery.data, workflow],
  );
  const events = useMemo(
    () =>
      workflow ? runtimeEvents(workflow, auditQuery.data?.items ?? []) : [],
    [auditQuery.data, workflow],
  );
  const refreshWorkflowIntelligence = async () => {
    await Promise.all([
      query.refetch(),
      taskQuery.refetch(),
      auditQuery.refetch(),
    ]);
  };

  if (query.isPending) {
    return (
      <PageFrame title="Workflow" description="Loading workflow…">
        <Stack gap="lg">
          {BACK}
          <Skeleton height="4rem" />
          <Skeleton height="12rem" />
          <Skeleton height="14rem" />
        </Stack>
      </PageFrame>
    );
  }

  if (query.isError || !workflow) {
    const notFound =
      isApiError(query.error) && query.error.category === "not_found";
    const forbidden =
      isApiError(query.error) && query.error.category === "forbidden";
    return (
      <PageFrame title="Workflow" description="Workflow detail">
        <Stack gap="lg">
          {BACK}
          <ErrorState
            variant={
              notFound ? "not-found" : forbidden ? "forbidden" : "network"
            }
            title={
              notFound
                ? "Workflow not found"
                : forbidden
                  ? "Access restricted"
                  : "Unable to load this workflow"
            }
            detail={
              notFound
                ? "The requested workflow does not exist or is no longer available."
                : forbidden
                  ? "You do not have permission to view this workflow."
                  : "The Control Center could not retrieve this workflow."
            }
            action={
              !notFound && !forbidden ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void query.refetch()}
                >
                  Retry
                </Button>
              ) : undefined
            }
          />
        </Stack>
      </PageFrame>
    );
  }

  const selectedNode =
    graph?.nodes.find((node) => node.id === selectedNodeId) ??
    graph?.nodes.find((node) => node.isCurrent) ??
    graph?.nodes[0];
  const graphError =
    taskQuery.isError && isApiError(taskQuery.error)
      ? taskQuery.error.category === "forbidden"
        ? "forbidden"
        : "error"
      : taskQuery.isError
        ? "error"
        : undefined;

  return (
    <PageFrame
      title={workflow.name}
      description="Workflow intelligence"
      actions={<StatusBadge status={workflow.status} />}
    >
      <Stack gap="lg">
        {BACK}
        <WorkflowDetailHeader workflow={workflow} />
        {workflow.error ? (
          <Alert tone="danger" title="Latest workflow error">
            {workflow.error}
          </Alert>
        ) : null}

        <div className="workflow-detail-grid">
          <Stack gap="lg" className="workflow-detail-grid__main">
            <Section title="Overview">
              <WorkflowOverviewCard workflow={workflow} />
            </Section>
            <Section title="Operations">
              <WorkflowOperations
                workflow={workflow}
                onChanged={refreshWorkflowIntelligence}
              />
            </Section>
            <Section title="Workflow steps and dependencies">
              <WorkflowGraph
                nodes={graph?.nodes ?? []}
                edges={graph?.edges ?? []}
                selectedNodeId={selectedNode?.id}
                isLoading={taskQuery.isPending}
                error={graphError}
                onRetry={() => void taskQuery.refetch()}
                onSelect={setSelectedNodeId}
                hasCompleteTaskSet={graph?.hasCompleteTaskSet ?? true}
              />
            </Section>
            <Section title="Execution summary">
              <WorkflowExecutionSummary workflow={workflow} />
            </Section>
            <Section title="Runtime intelligence">
              <WorkflowRuntimeCard
                workflow={workflow}
                isPending={auditQuery.isPending}
                isError={auditQuery.isError}
                error={auditQuery.error}
                onRetry={() => void auditQuery.refetch()}
              />
            </Section>
            <Section title="Step executions">
              <WorkflowStepExecutions steps={stepExecutions} />
            </Section>
            <Section title="Runtime events">
              <WorkflowRuntimeEvents events={events} />
            </Section>
            <Section title="Workflow audit activity">
              <WorkflowAuditSummary events={events} />
            </Section>
            <Section title="Workflow provenance">
              <WorkflowProvenanceCard
                workflow={workflow}
                tasks={taskQuery.data?.items ?? []}
                events={events}
              />
            </Section>
            <Section title="Trigger">
              <WorkflowTriggerCard />
            </Section>
          </Stack>

          <Stack gap="lg" className="workflow-detail-grid__aside">
            <Section title="Workflow governance">
              <WorkflowGovernanceCard
                workflow={workflow}
                role={role}
                allowedProjects={allowedProjects}
              />
            </Section>
            <Section title="Approvals">
              <WorkflowApprovalSummary
                workflow={workflow}
                tasks={taskQuery.data?.items ?? []}
              />
            </Section>
            <Section title="Context">
              <WorkflowContextCard workflow={workflow} />
            </Section>
            <Section title="Participants">
              <WorkflowParticipantsCard workflow={workflow} />
            </Section>
            {selectedNode ? (
              <Section title="Selected step">
                <WorkflowNodeDetails node={selectedNode} />
              </Section>
            ) : null}
          </Stack>
        </div>
      </Stack>
    </PageFrame>
  );
}
