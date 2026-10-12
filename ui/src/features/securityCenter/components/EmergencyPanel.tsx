import { useState } from "react";
import { OctagonAlert } from "lucide-react";
import { Button } from "../../../components/ui";
import { useCanAdminister, useCanManage } from "../hooks/useTrust";
import { emergencyControls } from "../lib/logic";
import { useT } from "../lib/useT";
import type { Emergency } from "../types";
import { CommandDialog } from "./CommandDialog";
import { DefList, Notice, Tag } from "./common";

type Dialog = "stop" | "investigate" | "recover" | "resume" | null;

/** The emergency control. The server decides every transition; the UI only offers the buttons that fit the current state. */
export function EmergencyPanel({ emergency, showHistory = true }: { emergency: Emergency; showHistory?: boolean }) {
  const { tt, label, formatTime } = useT();
  const canManage = useCanManage();
  const isAdmin = useCanAdminister();
  const [dialog, setDialog] = useState<Dialog>(null);
  const controls = emergencyControls(emergency.state);
  const close = () => setDialog(null);
  const active = emergency.state !== "NORMAL";

  return (
    <section className="sc-panel" aria-labelledby="sc-emergency-title" data-testid="emergency-panel" data-state={emergency.state}>
      <div className="sc-header-row">
        <h2 id="sc-emergency-title" className="sc-panel__title">{tt("emergency.title")}</h2>
        <Tag tone={active ? "danger" : "success"}>{label("emergency", emergency.state)}</Tag>
      </div>
      <p className="sc-muted">{tt("emergency.recoveryExplained")}</p>
      <DefList
        items={[
          { label: tt("emergency.state"), value: label("emergency", emergency.state) },
          ...(emergency.reason ? [{ label: tt("emergency.reason"), value: <span className="sc-text">{emergency.reason}</span> }] : []),
          ...(emergency.engagedBy ? [{ label: tt("emergency.engagedBy"), value: emergency.engagedBy }] : []),
          ...(emergency.engagedAt ? [{ label: tt("emergency.engagedAt"), value: formatTime(emergency.engagedAt) }] : []),
        ]}
      />

      {canManage ? (
        <div className="sc-actions">
          {controls.stop ? <Button type="button" variant="danger" onClick={() => setDialog("stop")}><OctagonAlert size={14} aria-hidden /> {tt("emergency.stop")}</Button> : null}
          {controls.investigate ? <Button type="button" variant="secondary" onClick={() => setDialog("investigate")}>{tt("emergency.investigate")}</Button> : null}
          {controls.recover ? <Button type="button" variant="secondary" onClick={() => setDialog("recover")}>{tt("emergency.requireRecovery")}</Button> : null}
          {controls.resume && isAdmin ? <Button type="button" variant="primary" onClick={() => setDialog("resume")}>{tt("emergency.resume")}</Button> : null}
        </div>
      ) : (
        <Notice>{tt("common.readOnly")}</Notice>
      )}
      {controls.resume && canManage && !isAdmin ? <Notice tone="warning">{tt("emergency.resumeAdminOnly")}</Notice> : null}

      {showHistory ? (
        <div className="sc-sub">
          <h3 className="sc-sub__title">{tt("emergency.history")}</h3>
          {emergency.history.length === 0 ? <p className="sc-muted">{tt("emergency.noHistory")}</p> : (
            <ol className="sc-timeline">
              {[...emergency.history].reverse().map((item, index) => (
                <li key={`${item.at}-${index}`} className="sc-timeline__item">
                  <div className="sc-row__meta">
                    <strong>{label("emergency", item.state)}</strong>
                    <span className="sc-muted">{formatTime(item.at)}</span>
                    <span className="sc-muted">{item.by}</span>
                  </div>
                  {item.note ? <p className="sc-text">{item.note}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}

      {dialog === "stop" ? (
        <CommandDialog
          title={tt("emergency.stopTitle")}
          description={tt("emergency.stopBody")}
          confirmLabel={tt("emergency.stop")}
          command="security_emergency_stop"
          buildBody={(note) => ({ reason: note })}
          danger
          noteLabel={tt("emergency.reasonLabel")}
          noteRequired
          onClose={close}
        />
      ) : null}
      {dialog === "investigate" ? (
        <CommandDialog
          title={tt("emergency.investigate")}
          description={tt("emergency.investigateBody")}
          confirmLabel={tt("emergency.investigate")}
          command="security_emergency_advance"
          buildBody={(note) => ({ to: "INVESTIGATING", ...(note ? { note } : {}) })}
          noteLabel={tt("common.noteOptional")}
          onClose={close}
        />
      ) : null}
      {dialog === "recover" ? (
        <CommandDialog
          title={tt("emergency.requireRecovery")}
          description={tt("emergency.recoverBody")}
          confirmLabel={tt("emergency.requireRecovery")}
          command="security_emergency_advance"
          buildBody={(note) => ({ to: "RECOVERY_REQUIRED", ...(note ? { note } : {}) })}
          noteLabel={tt("common.noteOptional")}
          onClose={close}
        />
      ) : null}
      {dialog === "resume" ? (
        <CommandDialog
          title={tt("emergency.resumeTitle")}
          description={tt("emergency.resumeBody")}
          confirmLabel={tt("emergency.resume")}
          command="security_emergency_resume"
          buildBody={(note) => ({ note })}
          noteLabel={tt("emergency.resumeNoteLabel")}
          noteRequired
          onClose={close}
        />
      ) : null}
    </section>
  );
}
