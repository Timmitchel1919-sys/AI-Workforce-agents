import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useLiveEvents } from "../hooks/useLiveEvents";
import { useRefreshExecution, useSession } from "../hooks/useRuntime";
import { changesByPath } from "../lib/logic";
import { useT } from "../lib/useT";
import type { RuntimeSession } from "../types";
import { CenterPanel, type CenterTab } from "./CenterPanel";
import { DefList, ErrorPanel, Skeleton, StatusTag, Unavailable } from "./common";
import { FileTree } from "./FileTree";
import { Inspector } from "./Inspector";
import { OverviewStrip, SessionPicker } from "./SessionPicker";
import { Terminal } from "./Terminal";

function SessionView({ session }: { session: RuntimeSession }) {
  const { tt, label } = useT();
  const refresh = useRefreshExecution(session.executionId);
  const live = useLiveEvents(session, refresh);
  const [tab, setTab] = useState<CenterTab>("files");
  const [filePath, setFilePath] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const status = live.liveStatus ?? session.status;
  const changes = useMemo(() => changesByPath(session.changes), [session.changes]);

  return (
    <div className="lw-session-view">
      <header className="lw-panel lw-area-header" aria-labelledby="lw-header-heading">
        <div className="lw-header__top">
          <Link to="/workspace" className="lw-link lw-back"><ArrowLeft size={14} aria-hidden /> {tt("detail.back")}</Link>
          <button type="button" className="ui-button secondary" aria-expanded={picking} onClick={() => setPicking(!picking)}>
            {tt("detail.switchSession")}
          </button>
        </div>
        <h2 id="lw-header-heading" className="lw-panel__title">{tt("detail.title")}</h2>
        <DefList
          items={[
            { label: tt("header.project"), value: session.projectId },
            { label: tt("header.workflow"), value: session.runId ?? <Unavailable /> },
            { label: tt("header.status"), value: <StatusTag status={status} /> },
            { label: tt("header.agent"), value: session.agentId },
            { label: tt("header.task"), value: session.taskId },
          ]}
        />
        <OverviewStrip />
        {picking ? <SessionPicker selectedId={session.executionId} /> : null}
      </header>
      <Inspector session={session} status={status} />
      <CenterPanel session={session} tab={tab} onTab={setTab} filePath={filePath} />
      <Terminal
        live={live}
        commands={session.commands}
        statusLine={tt("terminal.statusLine", { status: label("state", status) })}
      />
      <FileTree
        executionId={session.executionId}
        changes={changes}
        selectedPath={filePath}
        onOpen={(path) => { setFilePath(path); setTab("files"); }}
      />
    </div>
  );
}

function SessionLoader({ executionId }: { executionId: string }) {
  const { tt } = useT();
  const { session, isLoading, error, refetch } = useSession(executionId);
  if (error && !session) {
    return (
      <div className="lw-stack">
        <Link to="/workspace" className="lw-link lw-back"><ArrowLeft size={14} aria-hidden /> {tt("detail.back")}</Link>
        <ErrorPanel error={error} onRetry={() => void refetch()} focus />
      </div>
    );
  }
  if (isLoading || !session) return <Skeleton label={tt("detail.loading")} />;
  return <SessionView key={session.executionId} session={session} />;
}

/** Observational view of one runtime execution (or the session list). Nothing here executes commands. */
export function LiveWorkspace() {
  const { executionId } = useParams();
  const { tt } = useT();
  if (executionId) return <SessionLoader executionId={executionId} />;
  return (
    <div className="lw-stack">
      <section className="lw-panel" aria-label={tt("overview.label")}>
        <OverviewStrip />
      </section>
      <SessionPicker />
    </div>
  );
}
