import { useState } from "react";
import { Button } from "../../../components/ui";
import { useIsAdmin, useKnowledgeCommand, useOverview } from "../hooks/useKnowledge";
import { useT } from "../lib/useT";
import { ConfirmDialog } from "./ConfirmDialog";
import { CapabilityNotes } from "./OverviewTab";
import { DefList, ErrorPanel, Notice, Skeleton, Tag } from "./common";

const POLICY_KEYS = ["policy1", "policy2", "policy3", "policy4", "policy5"] as const;
const RETENTION_KEYS = ["retention1", "retention2", "retention3"] as const;

export function SettingsTab({ projectId }: { projectId: string | undefined }) {
  const { tt } = useT();
  const admin = useIsAdmin();
  const overview = useOverview(projectId);
  const command = useKnowledgeCommand();
  const [confirming, setConfirming] = useState(false);
  const archived = command.data ? Number((command.data.details as { archived?: unknown }).archived ?? 0) : null;
  const yesNo = (value: boolean) => <Tag tone={value ? "success" : "neutral"}>{value ? tt("common.yes") : tt("common.no")}</Tag>;

  return (
    <div className="kn-stack">
      <section className="kn-panel" aria-labelledby="kn-policy-heading">
        <h2 id="kn-policy-heading" className="kn-panel__title">{tt("settings.policyTitle")}</h2>
        <ul className="kn-list">
          {POLICY_KEYS.map((key) => <li key={key} className="kn-text">{tt(`settings.${key}`)}</li>)}
        </ul>
      </section>
      <section className="kn-panel" aria-labelledby="kn-retention-heading">
        <h2 id="kn-retention-heading" className="kn-panel__title">{tt("settings.retentionTitle")}</h2>
        <ul className="kn-list">
          {RETENTION_KEYS.map((key) => <li key={key} className="kn-text">{tt(`settings.${key}`)}</li>)}
        </ul>
        {admin ? (
          <div className="kn-stack">
            <div className="kn-actions">
              <Button type="button" variant="secondary" onClick={() => { command.reset(); setConfirming(true); }}>{tt("settings.applyRetention")}</Button>
            </div>
            {archived !== null ? <Notice tone="success">{tt("settings.retentionApplied", { count: archived })}</Notice> : null}
            {command.error && !confirming ? <ErrorPanel error={command.error} /> : null}
          </div>
        ) : <p className="kn-muted">{tt("settings.adminOnly")}</p>}
      </section>
      <section className="kn-panel" aria-labelledby="kn-caps-heading">
        <h2 id="kn-caps-heading" className="kn-panel__title">{tt("settings.capabilitiesTitle")}</h2>
        {overview.error ? <ErrorPanel error={overview.error} onRetry={() => void overview.refetch()} /> : null}
        {overview.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
        {overview.data ? (
          <>
            <DefList items={[
              { label: tt("settings.capRetrieval"), value: overview.data.capabilities.retrieval },
              { label: tt("settings.capEmbeddings"), value: yesNo(overview.data.capabilities.embeddings) },
              { label: tt("settings.capPdf"), value: yesNo(overview.data.capabilities.pdfExtraction) },
              { label: tt("settings.capWrite"), value: yesNo(overview.data.capabilities.canWrite) },
            ]} />
            <CapabilityNotes {...overview.data.capabilities} />
          </>
        ) : null}
      </section>
      {confirming ? (
        <ConfirmDialog
          open
          title={tt("settings.applyRetentionTitle")}
          description={tt("settings.applyRetentionHelp")}
          confirmLabel={tt("settings.applyRetention")}
          pending={command.isPending}
          error={command.error}
          onCancel={() => setConfirming(false)}
          onConfirm={() => command.mutate({ command: "knowledge_apply_retention", body: {} }, { onSuccess: () => setConfirming(false) })}
        />
      ) : null}
    </div>
  );
}
