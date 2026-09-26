export interface WorkforceGraphProjection {
  projectId: string;
  revision: number;
  generatedAt: string;
  nodes: WorkforceGraphNode[];
  edges: WorkforceGraphEdge[];
  metadata?: Record<string, string>;
}

export type WorkforceGraphNodeType = 
  | "PROJECT"
  | "PROGRAM"
  | "WORKSTREAM"
  | "TASK"
  | "AGENT"
  | "CAPABILITY"
  | "MODEL"
  | "ENVIRONMENT"
  | "RUNNER"
  | "EXECUTION_PLAN"
  | "EXECUTION_SESSION"
  | "WORKSPACE"
  | "WRITE_SCOPE"
  | "CHANGESET"
  | "VERIFICATION"
  | "REVIEW"
  | "APPROVAL"
  | "REPOSITORY"
  | "COMMIT"
  | "ARTIFACT"
  | "DEPLOYMENT";

export interface WorkforceGraphNode {
  id: string;
  type: WorkforceGraphNodeType;
  label: string;
  status: string;
  projectId: string;
  referenceId: string;
  metadata?: Record<string, string | number | boolean | undefined>;
}

export type WorkforceGraphEdgeType = 
  | "CONTAINS"
  | "HAS_TASK"
  | "DEPENDS_ON"
  | "ASSIGNED_TO"
  | "REQUIRES"
  | "QUALIFIED_FOR"
  | "ROUTED_TO"
  | "RUNS_ON"
  | "HOLDS_LEASE"
  | "OWNS_SCOPE"
  | "USES_MODEL"
  | "EXECUTES"
  | "PRODUCES"
  | "VERIFIED_BY"
  | "REVIEWED_BY"
  | "REQUIRES_APPROVAL"
  | "COMMITTED_AS"
  | "PUSHED_TO"
  | "DEPLOYED_TO"
  | "PRODUCES_ARTIFACT";

export interface WorkforceGraphEdge {
  id: string;
  type: WorkforceGraphEdgeType;
  source: string;
  target: string;
  status?: string;
  metadata?: Record<string, string>;
}

export interface GraphQueryOptions {
  projectId: string;
  depth?: number;
  nodeTypes?: WorkforceGraphNodeType[];
  maxNodes?: number;
  maxEdges?: number;
  rootNodeId?: string;
}
