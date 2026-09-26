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

import "./SpatialGraphPage.css";

export default function SpatialGraphPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useI18n();
  
  // For EO-5.4 we need a project ID context. In the Control Center, if we are at root level /graph,
  // we might not have projectId in the URL. We should use a selected project or default.
  // We will assume `default` if not specified for the demo.
  const activeProjectId = projectId || "default";

  const { graph, loading, error } = useSpatialGraph(activeProjectId);
  const [selectedNode, setSelectedNode] = useState<WorkforceGraphNode | null>(null);

  if (loading) return <Spinner />;
  if (error) return <ErrorState title="Failed to load graph" description={error.message} />;
  if (!graph) return <EmptyState icon={<Network />} title="No Graph Data" description="The workforce relationship graph is empty." />;

  return (
    <div className="spatial-graph-page">
      <PageHeader
        title={t("nav.spatialGraph")}
        description="Interactive 3D projection of the AI Workforce domain."
      />
      
      <div className="spatial-graph-container">
        <div className="spatial-graph-canvas-wrapper">
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
      </div>
    </div>
  );
}
