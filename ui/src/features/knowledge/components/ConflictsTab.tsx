import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../../components/ui";
import { useCanManage, useConflicts, useKnowledgeCommand } from "../hooks/useKnowledge";
import { useT } from "../lib/useT";
import type { Conflict, ConflictResolution } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Empty, ErrorPanel, Notice, Skeleton } from "./common";

interface Pending { conflict: Conflict; resolution: ConflictResolution; winner?: string }

/** Conflicts are never auto-resolved: every resolution needs an explicit click and a confirmation. */
export function ConflictsTab({ projectId, search }: { projectId: string | undefined; search: string }) {
  const { tt } = useT();
  const canManage = useCanManage();
  const query = useConflicts(projectId);
  const command = useKnowledgeCommand();
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState(false);

  const ask = (next: Pending) => { command.reset(); setDone(false); setPending(next); };
  const confirm = (note: string) => {
    if (!pending) return;
    command.mutate(
      {
        command: "knowledge_resolve_conflict",
        body: {
          conflictId: pending.conflict.conflictId,
          resolution: pending.resolution,
          ...(pending.winner ? { winner: pending.winner } : {}),
          ...(note ? { note } : {}),
        },
      },
      { onSuccess: () => { setPending(null); setDone(true); } },
    );
  };

  if (query.error) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !query.data) return <Skeleton label={tt("common.loading")} />;

  const winnerTitle = pending?.winner
    ? pending.conflict.titles[pending.conflict.memoryIds.indexOf(pending.winner)] ?? pending.winner
    : "";

  return (
    <div className="kn-stack">
      <section className="kn-panel" aria-labelledby="kn-conf-heading">
        <h2 id="kn-conf-heading" className="kn-panel__title">{tt("conflicts.title")}</h2>
        <p className="kn-muted">{tt("conflicts.help")}</p>
        {done ? <Notice tone="success">{tt("conflicts.resolved")}</Notice> : null}
        {!canManage ? <p className="kn-muted">{tt("common.readOnly")}</p> : null}
        {query.data.length === 0 ? <Empty title={tt("conflicts.emptyTitle")} body={tt("conflicts.emptyBody")} /> : null}
        <ul className="kn-rows">
          {query.data.map((conflict) => (
            <li key={conflict.conflictId} className="kn-row" data-conflict-id={conflict.conflictId}>
              <h3 className="kn-sub__title">{tt("conflicts.facet", { facet: conflict.facet })}</h3>
              <div className="kn-versus">
                {([0, 1] as const).map((i) => (
                  <div key={conflict.memoryIds[i]} className="kn-sub">
                    <Link className="kn-link kn-row__title" to={`/knowledge/memories/${encodeURIComponent(conflict.memoryIds[i])}${search}`}>{conflict.titles[i]}</Link>
                    <p className="kn-text"><span className="kn-muted">{tt("conflicts.value")}</span> {conflict.values[i]}</p>
                    {canManage ? (
                      <div className="kn-actions">
                        <Button type="button" variant="primary" size="small" aria-label={tt("conflicts.keepThisAria", { title: conflict.titles[i] })}
                          onClick={() => ask({ conflict, resolution: "SUPERSEDED_OTHER", winner: conflict.memoryIds[i] })}>
                          {tt("conflicts.keepThis")}
                        </Button>
                        <Button type="button" variant="secondary" size="small" aria-label={tt("conflicts.archiveOtherAria", { title: conflict.titles[i] })}
                          onClick={() => ask({ conflict, resolution: "ARCHIVED_OTHER", winner: conflict.memoryIds[i] })}>
                          {tt("conflicts.archiveOther")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="kn-text" data-testid="conflict-suggestion"><strong>{tt("conflicts.suggestion")}</strong> {conflict.suggestion}</p>
              {canManage ? (
                <div className="kn-actions">
                  <Button type="button" variant="secondary" size="small" onClick={() => ask({ conflict, resolution: "KEPT_BOTH" })}>{tt("conflicts.keepBoth")}</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {pending ? (
        <ConfirmDialog
          open
          danger={pending.resolution !== "KEPT_BOTH"}
          title={tt("conflicts.confirmTitle")}
          description={
            pending.resolution === "KEPT_BOTH"
              ? tt("conflicts.confirmKeepBoth", { facet: pending.conflict.facet })
              : pending.resolution === "SUPERSEDED_OTHER"
                ? tt("conflicts.confirmSupersede", { winner: winnerTitle })
                : tt("conflicts.confirmArchive", { winner: winnerTitle })
          }
          confirmLabel={tt(`conflicts.confirmAction.${pending.resolution}`)}
          noteLabel={tt("conflicts.note")}
          pending={command.isPending}
          error={command.error}
          onCancel={() => { setPending(null); command.reset(); }}
          onConfirm={confirm}
        />
      ) : null}
    </div>
  );
}
