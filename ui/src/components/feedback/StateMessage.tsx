import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2, ShieldAlert } from "lucide-react";

type Tone = "loading" | "empty" | "error" | "forbidden";

const ICON: Record<Tone, typeof Inbox> = {
  loading: Loader2,
  empty: Inbox,
  error: AlertTriangle,
  forbidden: ShieldAlert,
};

/**
 * The canonical loading / empty / error / forbidden state. Every data view uses
 * this so those states are handled consistently even before UI-2 styling.
 */
export function StateMessage({
  tone,
  title,
  detail,
  action,
}: {
  tone: Tone;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  const Icon = ICON[tone];
  return (
    <div className={`state-message state-message--${tone}`} role="status">
      <Icon
        className={
          tone === "loading"
            ? "state-message__icon spin"
            : "state-message__icon"
        }
        aria-hidden="true"
      />
      <p className="state-message__title">{title}</p>
      {detail ? <p className="state-message__detail">{detail}</p> : null}
      {action ? <div className="state-message__action">{action}</div> : null}
    </div>
  );
}
