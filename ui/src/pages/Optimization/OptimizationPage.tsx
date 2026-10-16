import { Link } from "react-router-dom";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useAgents } from "../../features/agents";
import { useProjectCostReport } from "../../features/costCenter";
import { useProjectRoutingDecisions } from "../../features/modelRouting/useModelRouting";
import { ProjectPicker } from "../../features/projectScope/ProjectPicker";
import { useActiveProject } from "../../features/projectScope/useActiveProject";
import {
  agentPerformance,
  modelUsage,
  recommendations,
  routingSummary,
} from "../../features/intelligence/intelligenceAnalytics";
import { useI18n, type MessageKey } from "../../i18n";
import "../Operations/OperationsPage.css";

/**
 * Optimization & Strategy (UI Layer 12). Reuses the Layer 6 evidence model
 * (no second recommendation or synthesis engine). The Universal Synthesis
 * Engine is not implemented, and the page says so instead of inventing
 * strategy output.
 */
export default function OptimizationPage() {
  const { t } = useI18n();
  const active = useActiveProject();
  const projectId = active.projectId ?? "";
  const agents = useAgents();
  return (
    <PageContainer variant="wide">
      <PageHeader eyebrow={t("common.brand")} title={t("optimizationCenter.title")} description={t("optimizationCenter.description")} />
      <p className="ops-card" role="note">{t("optimizationCenter.synthesisGap")}</p>
      <div style={{ margin: "12px 0" }}>
        <ProjectPicker projects={active.projects} value={projectId} onChange={active.select} />
      </div>
      {projectId ? <Recs key={projectId} projectId={projectId} agents={agents.data?.agents ?? []} /> : null}
      <p>
        <Link to={`/intelligence?project=${encodeURIComponent(projectId)}`}>{t("optimizationCenter.openIntelligence")}</Link>
        {" · "}
        <Link to="/workflow-studio">{t("optimizationCenter.openStudio")}</Link>
      </p>
    </PageContainer>
  );
}

function Recs({ projectId, agents }: { projectId: string; agents: Parameters<typeof agentPerformance>[0] }) {
  const { t } = useI18n();
  const routing = useProjectRoutingDecisions(projectId);
  const cost = useProjectCostReport(projectId);
  const recs = recommendations({
    performance: agentPerformance(agents),
    routing: routing.data?.configured ? routingSummary(routing.data.decisions) : undefined,
    usage: cost.data?.configured ? modelUsage(cost.data.usage) : [],
  });
  return (
    <section className="ops-card">
      <h2>{t("intelligenceCenter.tabs.recommendations")}</h2>
      <p className="ops-muted">{t("intelligenceCenter.recommendations.intro")}</p>
      {recs.length === 0 ? <p className="ops-muted">{t("intelligenceCenter.recommendations.empty")}</p> : null}
      <ul className="ops-list">
        {recs.map((r) => (
          <li key={`${r.kind}-${r.subject}`}>
            {t(`intelligenceCenter.recommendations.kinds.${r.kind}` as MessageKey, { subject: r.subject, ...r.evidence })} —{" "}
            {t(`intelligenceCenter.recommendations.confidence.${r.confidence}` as MessageKey)}
          </li>
        ))}
      </ul>
    </section>
  );
}
