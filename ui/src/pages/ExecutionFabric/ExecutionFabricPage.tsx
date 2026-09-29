import { useState } from "react";
import { Server, Shield, Box } from "lucide-react";
import { useI18n } from "../../i18n";
import { Button, Card, Badge, Tabs } from "../../components/ui";

export function ExecutionFabricPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"runners" | "sandboxes" | "workspaces">("runners");

  return (
    <div className="page fade-in">
      <header className="page-header">
        <p className="eyebrow">{t("common.brand")}</p>
        <h1>{t("nav.executionFabric" as any) || "Execution Fabric"}</h1>
        <p className="page-description">
          Manage Sandboxes, Cloud Runners, Workspaces, and Tool Gateways.
        </p>
      </header>
      
      <div className="gov-toolbar" style={{ marginBottom: "2rem", display: "flex", gap: "1rem", justifyContent: "space-between", alignItems: "flex-end" }}>
        <Tabs 
          activeId={activeTab} 
          onChange={(id) => setActiveTab(id as any)}
          items={[
            { id: "runners", label: "Cloud Runners" },
            { id: "sandboxes", label: "Sandboxes" },
            { id: "workspaces", label: "Workspaces" }
          ]} 
        />
        <Button variant="primary">
          Provision {activeTab === "runners" ? "Runner" : activeTab === "sandboxes" ? "Sandbox" : "Workspace"}
        </Button>
      </div>

      <div style={{ marginTop: "2rem" }}>
        {activeTab === "runners" && (
          <section>
            <h2>Cloud Runners</h2>
            <p className="gov-muted" style={{ marginBottom: "1rem" }}>Isolated execution environments for tasks and agents.</p>
            <div className="infra-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "1rem" }}>
              <RunnerCard name="runner-alpha-1" status="running" cpu="45%" mem="2.1GB" type="Standard" />
              <RunnerCard name="runner-beta-2" status="idle" cpu="1%" mem="500MB" type="High-Memory" />
              <RunnerCard name="runner-gamma-3" status="offline" cpu="-" mem="-" type="GPU-Accelerated" />
            </div>
          </section>
        )}
        
        {activeTab === "sandboxes" && (
          <section>
            <h2>Sandboxes</h2>
            <p className="gov-muted" style={{ marginBottom: "1rem" }}>Secure boundaries for untrusted execution.</p>
            <div className="infra-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "1rem" }}>
              <SandboxCard name="python-sandbox-test" policy="strict" activeTools={3} />
              <SandboxCard name="node-sandbox-build" policy="standard" activeTools={8} />
            </div>
          </section>
        )}

        {activeTab === "workspaces" && (
          <section>
            <h2>Workspaces</h2>
            <p className="gov-muted" style={{ marginBottom: "1rem" }}>Shared file systems for collaborative agent work.</p>
            <div className="infra-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "1rem" }}>
              <WorkspaceCard name="frontend-refactor" size="145MB" files={342} />
              <WorkspaceCard name="backend-api-v2" size="430MB" files={1204} />
            </div>
          </section>
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
        <Badge variant={status === "running" ? "success" : status === "idle" ? "warning" : "neutral"}>{status}</Badge>
      </div>
      <dl className="infra-facts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "1rem", fontSize: "0.875rem" }}>
        <div><dt className="gov-muted">Type</dt><dd>{type}</dd></div>
        <div><dt className="gov-muted">CPU Usage</dt><dd>{cpu}</dd></div>
        <div><dt className="gov-muted">Memory</dt><dd>{mem}</dd></div>
        <div><dt className="gov-muted">Uptime</dt><dd>3d 4h 12m</dd></div>
      </dl>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Button variant="secondary" size="small" style={{ flex: 1 }}>View Logs</Button>
        <Button variant="secondary" size="small">Restart</Button>
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
