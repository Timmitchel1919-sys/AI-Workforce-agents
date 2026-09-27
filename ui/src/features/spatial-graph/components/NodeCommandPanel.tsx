import { useContext } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { authContext } from "../../../auth/authContext";
import { useI18n, type MessageKey } from "../../../i18n";
import type { WorkforceGraphNode } from "../../../../../contracts/graph";
import { actionsFor, inspectionLinksFor } from "../lib/nodeActions";
import type { NodeAction } from "../lib/nodeActions";

interface Props {
  node: WorkforceGraphNode;
  /**
   * Starts a confirmation. The command state machine and its dialog live in the WORKSPACE, not
   * here, so a request in flight survives this panel unmounting (node deselected or pruned by a
   * live refresh) and its result is always shown.
   */
  onBegin: (action: NodeAction, nodeLabel: string) => void;
  /** A command is in flight: no other can start. */
  busy: boolean;
}

/**
 * Contextual actions for the selected node, kept in the inspector (never over the 3D canvas).
 * READ-ONLY inspection links are separate from STATE-CHANGING actions, which are labelled as such
 * and always go through a confirmation. The action list is a hint from the node's last confirmed
 * state and the account's reported capabilities; the Control Plane authorises and re-checks
 * every command itself. A visible node grants no authority.
 */
export function NodeCommandPanel({ node, onBegin, busy }: Props) {
  // Without a signed-in account context there is no authority to act and no token to send:
  // render nothing rather than a control that cannot work.
  const auth = useContext(authContext);
  if (!auth) return null;
  return <ActivePanel node={node} capabilities={auth.accessDetails?.capabilities} onBegin={onBegin} busy={busy} />;
}

function ActivePanel({
  node,
  capabilities,
  onBegin,
  busy,
}: {
  node: WorkforceGraphNode;
  capabilities: readonly string[] | undefined;
  onBegin: (action: NodeAction, nodeLabel: string) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const inRouter = useInRouterContext();
  const actions = actionsFor(node, capabilities);
  // In-app links need a router; without one there is simply nothing to link to.
  const links = inRouter ? inspectionLinksFor(node) : [];
  if (actions.length === 0 && links.length === 0) return null;

  return (
    <section className="sg-cmd" aria-label={t("spatial.command.section")} data-testid="sg-commands">
      {links.length > 0 && (
        <div>
          <h3 className="sg-subtitle">{t("spatial.command.inspect")}</h3>
          <ul className="sg-cmd-list">
            {links.map((l) => (
              <li key={l.id}>
                <Link className="sg-link" to={l.to}>
                  {t(`spatial.command.link.${l.id}` as MessageKey)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {actions.length > 0 && (
        <div>
          <h3 className="sg-subtitle">{t("spatial.command.changeState")}</h3>
          <p className="sg-muted">{t("spatial.command.changeStateNote")}</p>
          <ul className="sg-cmd-list">
            {actions.map((a) => (
              <li key={a.command}>
                <button
                  type="button"
                  className={a.destructive ? "sg-btn sg-btn--danger" : "sg-btn"}
                  disabled={busy}
                  onClick={() => onBegin(a, node.label)}
                >
                  {t(`spatial.command.action.${a.command}` as MessageKey)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
