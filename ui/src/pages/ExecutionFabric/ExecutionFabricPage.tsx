import { useState } from "react";
import { Server, Activity, Shield, Box, Code } from "lucide-react";
import { useI18n } from "../../i18n";
import { Button, Input, Card, Badge, Tabs } from "../../components/ui";
import { Section } from "../../components/layout/Section";

export function ExecutionFabricPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"runners" | "sandboxes" | "workspaces">("runners");

  return (
    <div className="page fade-in">
      <header className="page-header">
        <p className="eyebrow">{t("common.brand")}</p>
        <h1>{t("nav.executionFabric") || "Execution Fabric"}</h1>
        <p className="page-description">
          Manage Sandboxes, Cloud Runners, Workspaces, and Tool Gateways.
        </p>
      </header>
      
      <div className="gov-toolbar" style={{ marginBottom: "2rem", display: "flex", gap: "1rem", justifyContent: "space-between" }}>
        <Tabs 
          tabs={[
            { id: "runners", label: "Cloud Runners" },
            { id: "sandboxes", label: "Sandboxes" },
            { id: "workspaces", label: "Workspaces" }
          ]} 
          activeTab={activeTab} 
          onChange={(id) => setActiveTab(id as any)} 
        />
        <Button variant="primary">
          Provision {activeTab === "runners" ? "Runner" : activeTab === "sandboxes" ? "Sandbox" : "Workspace"}
        </Button>
      </div>

      <div style={{ marginTop: "2rem" }}>
        {activeTab === "runners" && (
          <Section title="Cloud Runners" description="Isolated execution environments for tasks and agents.">
            <div className="infra-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "1rem" }}>
              <RunnerCard name="runner-alpha-1" status="running" cpu="45%" mem="2.1GB" type="Standard" />
              <RunnerCard name="runner-beta-2" status="idle" cpu="1%" mem="500MB" type="High-Memory" />
              <RunnerCard name="runner-gamma-3" status="offline" cpu="-" mem="-" type="GPU-Accelerated" />
            </div>
          </Section>
        )}
        
        {activeTab === "sandboxes" && (
          <Section title="Sandboxes" description="Secure boundaries for untrusted execution.">
            <div className="infra-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "1rem" }}>
              <SandboxCard name="python-sandbox-test" policy="strict" activeTools={3} />
              <SandboxCard name="node-sandbox-build" policy="standard" activeTools={8} />
            </div>
          </Section>
        )}

        {activeTab === "workspaces" && (
          <Section title="Workspaces" description="Shared file systems for collaborative agent work.">
            <div className="infra-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "1rem" }}>
              <WorkspaceCard name="frontend-refactor" size="145MB" files={342} />
              <WorkspaceCard name="backend-api-v2" size="430MB" files={1204} />
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function RunnerCard({ name, status, cpu, mem, type }: { name: string, status: "running" | "idle" | "offline", cpu: string, mem: string, type: string }) {
  return (
    <Card className="gov-card">
      <div className="gov-card__head" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <Server size={16} className="gov-muted" />
        <strong style={{ flex: 1 }}>{name}</strong>
        <Badge variant={status === "running" ? "success" : status === "idle" ? "warning" : "default"}>{status}</Badge>
      </div>
      <dl className="infra-facts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "1rem", fontSize: "0.875rem" }}>
        <div><dt className="gov-muted">Type</dt><dd>{type}</dd></div>
        <div><dt className="gov-muted">CPU Usage</dt><dd>{cpu}</dd></div>
        <div><dt className="gov-muted">Memory</dt><dd>{mem}</dd></div>
        <div><dt className="gov-muted">Uptime</dt><dd>3d 4h 12m</dd></div>
      </dl>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Button variant="secondary" size="sm" style={{ flex: 1 }}>View Logs</Button>
        <Button variant="outline" size="sm">Restart</Button>
      </div>
    </Card>
  );
}

function SandboxCard({ name, policy, activeTools }: { name: string, policy: string, activeTools: number }) {
  return (
    <Card className="gov-card">
      <div className="gov-card__head" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <Shield size={16} className="gov-muted" />
        <strong style={{ flex: 1 }}>{name}</strong>
      </div>
      <dl className="infra-facts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "1rem", fontSize: "0.875rem" }}>
        <div><dt className="gov-muted">Security Policy</dt><dd>{policy}</dd></div>
        <div><dt className="gov-muted">Active Tools</dt><dd>{activeTools}</dd></div>
      </dl>
    </Card>
  );
}

function WorkspaceCard({ name, size, files }: { name: string, size: string, files: number }) {
  return (
    <Card className="gov-card">
      <div className="gov-card__head" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <Box size={16} className="gov-muted" />
        <strong style={{ flex: 1 }}>{name}</strong>
      </div>
      <dl className="infra-facts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "1rem", fontSize: "0.875rem" }}>
        <div><dt className="gov-muted">Storage Size</dt><dd>{size}</dd></div>
        <div><dt className="gov-muted">Total Files</dt><dd>{files}</dd></div>
      </dl>
    </Card>
  );
}
