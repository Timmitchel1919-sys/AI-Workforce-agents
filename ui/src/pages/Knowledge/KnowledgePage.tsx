import { useState } from "react";
import { Book, Activity } from "lucide-react";
import { useI18n } from "../../i18n";
import { Button, Input, Card, Badge, Tabs } from "../../components/ui";

export function KnowledgePage() {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"records" | "candidates">("records");

  return (
    <div className="page fade-in">
      <header className="page-header">
        <p className="eyebrow">{t("common.brand")}</p>
        <h1>{t("nav.knowledge") || "Knowledge Engine"}</h1>
        <p className="page-description">
          Project-scoped knowledge, memory, and insights.
        </p>
      </header>
      
      <div className="gov-toolbar" style={{ marginBottom: "2rem", display: "flex", gap: "1rem", alignItems: "flex-end" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Input 
            placeholder="Search knowledge base..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button variant="primary">
          Add Knowledge
        </Button>
      </div>

      <Tabs 
        activeId={activeTab} 
        onChange={(id) => setActiveTab(id as any)}
        items={[
          { id: "records", label: "Knowledge Records" },
          { id: "candidates", label: "Memory Candidates" }
        ]} 
      />

      <div style={{ marginTop: "2rem" }}>
        {activeTab === "records" ? (
          <section>
            <h2>Knowledge Records</h2>
            <p className="gov-muted" style={{ marginBottom: "1rem" }}>Verified information available to all agents.</p>
            <div className="infra-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem" }}>
              <KnowledgeCard title="Architecture Guidelines" type="Document" date="2 hours ago" />
              <KnowledgeCard title="API Authentication" type="Snippet" date="1 day ago" />
              <KnowledgeCard title="Deployment Procedures" type="Runbook" date="3 days ago" />
            </div>
          </section>
        ) : (
          <section>
            <h2>Memory Candidates</h2>
            <p className="gov-muted" style={{ marginBottom: "1rem" }}>Insights waiting to be promoted to global knowledge.</p>
            <div className="infra-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem" }}>
              <KnowledgeCard title="Recent Bug Fix - Redis" type="Observation" date="1 hour ago" isCandidate />
              <KnowledgeCard title="User Feedback Summary" type="Analysis" date="5 hours ago" isCandidate />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function KnowledgeCard({ title, type, date, isCandidate = false }: { title: string, type: string, date: string, isCandidate?: boolean }) {
  return (
    <Card className="gov-card">
      <div className="gov-card__head" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        {isCandidate ? <Activity size={16} className="gov-muted" /> : <Book size={16} className="gov-muted" />}
        <strong style={{ flex: 1 }}>{title}</strong>
        <Badge variant={isCandidate ? "warning" : "success"}>{type}</Badge>
      </div>
      <div className="gov-card__body">
        <p className="gov-muted" style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
          Contains detailed information about {title.toLowerCase()}.
        </p>
      </div>
      <div className="gov-card__footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "1rem" }}>
        <span className="gov-muted" style={{ fontSize: "0.75rem" }}>{date}</span>
        {isCandidate && <Button variant="secondary" size="small">Promote</Button>}
      </div>
    </Card>
  );
}
