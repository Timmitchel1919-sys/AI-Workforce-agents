import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";

export default function SecurityPage() {
  const organizationId = import.meta.env.VITE_ORGANIZATION_ID as string | undefined;
  const [incidents, setIncidents] = useState<Array<Record<string, unknown>>>([]);
  const [selected, setSelected] = useState<string>("");
  const [targetAgent, setTargetAgent] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!organizationId) return;
    void apiRequest<{ incidents: Array<Record<string, unknown>> }>("/api/security/incidents", {
      headers: { "x-organization-id": organizationId },
    }).then((result) => setIncidents(result.incidents)).catch(() => setMessage("Incidentgegevens konden niet veilig worden geladen."));
  }, [organizationId]);
  async function requestContainment() {
    if (!organizationId || !selected || !targetAgent.trim() || !reason.trim()) {
      setMessage("Selecteer een incident, agent en reden.");
      return;
    }
    try {
      const result = await apiRequest<Record<string, unknown>>(`/api/security/incidents/${encodeURIComponent(selected)}/containment-requests`, {
        method: "POST", headers: { "x-organization-id": organizationId },
        body: JSON.stringify({ targetResourceType: "agent", targetResourceId: targetAgent, reason }),
      });
      setMessage(`Containment aangevraagd: ${String(result.id ?? "geregistreerd")}. Goedkeuring is vereist.`);
    } catch { setMessage("Containment-aanvraag geweigerd of niet beschikbaar."); }
  }
  return (
    <PageContainer>
      <PageHeader title="Security & Zero Trust" description="Threat Management & Zero Trust Policies" />
      <PageSection>
        <div className="flex flex-col gap-6">
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Zero Trust Policies</h2>
            <p className="text-muted-foreground">Manage context-aware access policies and boundary rules.</p>
            {/* Policy list */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Incidentrespons</h2>
            {!organizationId && <p className="text-muted-foreground">Geen organisatiecontext geconfigureerd; incidentdata blijft geblokkeerd.</p>}
            {organizationId && <>
              <label htmlFor="incident-select">Incident</label>
              <select id="incident-select" value={selected} onChange={(event) => setSelected(event.target.value)}>
                <option value="">Selecteer incident</option>
                {incidents.map((incident) => <option key={String(incident.incidentId)} value={String(incident.incidentId)}>{String(incident.title ?? incident.incidentId)}</option>)}
              </select>
              <label htmlFor="containment-agent">Agent voor simulatie/containment</label>
              <input id="containment-agent" value={targetAgent} onChange={(event) => setTargetAgent(event.target.value)} placeholder="agent-id" />
              <label htmlFor="containment-reason">Reden</label>
              <textarea id="containment-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
              <button type="button" onClick={() => void requestContainment()}>Containment aanvragen</button>
              <p role="status">{message}</p>
            </>}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Security Events</h2>
            <p className="text-muted-foreground">Monitor auth failures, policy violations, and prompt injection attempts.</p>
            {/* Event list */}
          </div>
          <div className="bg-surface rounded-lg p-6 border border-border">
            <h2 className="text-xl font-bold mb-4">Threat Intelligence</h2>
            <p className="text-muted-foreground">Ingest and action IOCs (Indicators of Compromise).</p>
            {/* Threat intelligence list */}
          </div>
        </div>
      </PageSection>
    </PageContainer>
  );
}
import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
