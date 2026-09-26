import { useState } from "react";
import { useParams } from "react-router-dom";
import { useI18n } from "../../i18n";
import { useSpatialGraph } from "../../features/spatial-graph/hooks/useSpatialGraph";
import { SpatialGraphView } from "../../features/spatial-graph/components/SpatialGraphView";
import PageHeader from "../../components/layout/PageHeader";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import type { WorkforceGraphNode } from "../../../../contracts/graph";
import { Network } from "lucide-react";
import { useProjects } from "../../features/executionPlans";

import "./SpatialGraphPage.css";

export default function SpatialGraphPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useI18n();
  const { status: projectsStatus, projects } = useProjects();
  
  const activeProjectId = projectId || (projects.length > 0 ? projects[0].projectId : null);
  const { graph, loading, error } = useSpatialGraph(activeProjectId || "");
  const [selectedNode, setSelectedNode] = useState<WorkforceGraphNode | null>(null);

  if (projectsStatus === "loading" || loading) return <Spinner />;
  if (projectsStatus === "empty" || !activeProjectId) return <EmptyState icon={<Network />} title="No Projects" description="You do not have access to any projects to view a graph." />;
  if (error) return <ErrorState title="Failed to load graph" description={error.message} />;
  if (!graph) return <EmptyState icon={<Network />} title="No Graph Data" description="The workforce relationship graph is empty." />;

  return (
    <div className="spatial-graph-page">
      <PageHeader
        title={t("nav.spatialGraph")}
        description="Interactive 3D projection of the AI Workforce domain."
      />
      
      <div className="spatial-graph-container">
        <div className="spatial-graph-canvas-wrapper" aria-hidden="true">
          <SpatialGraphView 
            graph={graph} 
            onNodeSelect={(node) => setSelectedNode(node)} 
          />
        </div>
        
        {selectedNode && (
          <div className="spatial-graph-inspector">
            <h3>{selectedNode.label}</h3>
            <span className="badge">{selectedNode.type}</span>
            <p><strong>Status:</strong> {selectedNode.status}</p>
            <p><strong>ID:</strong> {selectedNode.id}</p>
            
            {selectedNode.metadata && (
              <div className="metadata">
                <h4>Metadata</h4>
                <pre>{JSON.stringify(selectedNode.metadata, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        <div className="visually-hidden" aria-label="Accessible graph representation">
          <h3>Nodes</h3>
          <ul>
            {graph.nodes.map(n => (
              <li key={n.id}>
                <button onClick={() => setSelectedNode(n)}>
                  {n.type}: {n.label} (Status: {n.status})
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
