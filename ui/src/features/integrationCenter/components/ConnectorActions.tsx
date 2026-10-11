import { useState } from "react";
import { Button, Select } from "../../../components/ui";
import { useCanAdminister, useCanManage, useIntegrationCommand } from "../hooks/useIntegrations";
import { trustAllowed } from "../lib/logic";
import { useT } from "../lib/useT";
import { CONNECTOR_MODES, TRUST_STATES, type CommandResult, type Connector } from "../types";
import { CommandDialog } from "./CommandDialog";
import { CredentialDialog } from "./CredentialDialog";
import { Notice } from "./common";
import { useReport } from "./report";

type DialogKind = "connect" | "enable" | "disable" | "disconnect" | "mode" | "trust" | null;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The per-connector controls. A button the signed-in role cannot use is disabled (with the reason) rather than hidden;
 * the Control Plane enforces the same rules and its refusal text is shown if a command is still rejected.
 */
export type ActionConnector = Pick<Connector, "connectorId" | "name" | "mode" | "trust" | "enabled" | "auth">;

export function ConnectorActions({ connector, canStoreCredentials }: { connector: ActionConnector; canStoreCredentials: boolean }) {
  const { tt, label } = useT();
  const manage = useCanManage();
  const admin = useCanAdminister();
  const { report } = useReport();
  const run = useIntegrationCommand();
  const [open, setOpen] = useState<DialogKind>(null);
  const [mode, setMode] = useState<string>(connector.mode);
  const [trust, setTrust] = useState<string>(connector.trust);
  const { connectorId, name } = connector;
  const close = () => setOpen(null);

  const direct = (command: "integration_test_connection" | "integration_validate_security") => {
    run.mutate(
      { command, body: { connectorId } },
      {
        onSuccess: (result: CommandResult) => {
          const d = result.details;
          if (command === "integration_test_connection") {
            const ok = d["ok"] === true;
            const base = tt(ok ? "report.testOk" : "report.testFailed", { name, message: str(d["message"]) });
            const ms = typeof d["latencyMs"] === "number" ? ` ${tt("report.latency", { ms: d["latencyMs"] })}` : "";
            report({ tone: ok ? "success" : "danger", message: `${base}${ok ? ms : ""}` });
          } else {
            const ok = d["ok"] === true;
            const checks = Array.isArray(d["checks"]) ? (d["checks"] as { check: string; ok: boolean; detail: string }[]) : [];
            report({ tone: ok ? "success" : "warning", message: tt(ok ? "report.validateOk" : "report.validateFailed", { name }), checks });
          }
        },
        onError: (error: unknown) => report({ tone: "danger", title: tt("report.failedTitle"), message: error instanceof Error ? error.message : String(error) }),
      },
    );
  };

  const needManage = manage ? undefined : tt("common.needsManage");
  const needAdmin = admin ? undefined : tt("common.needsAdmin");
  const modeBlocked = !admin && connector.mode === "SANDBOX";

  return (
    <div className="ic-actions" role="group" aria-label={tt("common.actions")} data-testid={`actions-${connectorId}`}>
      <Button type="button" variant="primary" size="small" disabled={!admin} title={needAdmin} aria-label={tt("action.connectFor", { name })} onClick={() => setOpen("connect")}>
        {tt("action.connect")}
      </Button>
      <Button type="button" size="small" disabled={!manage || run.isPending} title={needManage} aria-label={tt("action.testFor", { name })} onClick={() => direct("integration_test_connection")}>
        {tt("action.test")}
      </Button>
      <Button type="button" size="small" disabled={!manage || run.isPending} title={needManage} aria-label={tt("action.validateFor", { name })} onClick={() => direct("integration_validate_security")}>
        {tt("action.validate")}
      </Button>
      {connector.enabled ? (
        <Button type="button" size="small" disabled={!manage} title={needManage} aria-label={tt("action.disableFor", { name })} onClick={() => setOpen("disable")}>
          {tt("action.disable")}
        </Button>
      ) : (
        <Button type="button" size="small" disabled={!admin} title={needAdmin} aria-label={tt("action.enableFor", { name })} onClick={() => setOpen("enable")}>
          {tt("action.enable")}
        </Button>
      )}
      <Button type="button" size="small" disabled={!manage || modeBlocked} title={!manage ? needManage : modeBlocked ? tt("common.needsAdmin") : undefined} aria-label={tt("action.modeFor", { name })} onClick={() => { setMode(connector.mode); setOpen("mode"); }}>
        {tt("action.mode")}
      </Button>
      <Button type="button" size="small" disabled={!manage} title={needManage} aria-label={tt("action.trustFor", { name })} onClick={() => { setTrust(connector.trust); setOpen("trust"); }}>
        {tt("action.trust")}
      </Button>
      <Button type="button" variant="danger" size="small" disabled={!admin} title={needAdmin} aria-label={tt("action.disconnectFor", { name })} onClick={() => setOpen("disconnect")}>
        {tt("action.disconnect")}
      </Button>

      {open === "connect" ? (
        <CredentialDialog
          connectorId={connectorId}
          connectorName={name}
          purpose="primary"
          canStore={canStoreCredentials}
          oauthConnector={connector.auth.method === "oauth2"}
          onClose={close}
        />
      ) : null}
      {open === "enable" ? (
        <CommandDialog
          title={tt("confirm.enableTitle", { name })}
          description={tt("confirm.enableBody")}
          submitLabel={tt("action.enable")}
          command="integration_enable"
          getBody={() => ({ connectorId })}
          successMessage={tt("report.commandOk", { message: tt("confirm.enableTitle", { name }) })}
          onClose={close}
        />
      ) : null}
      {open === "disable" ? (
        <CommandDialog
          title={tt("confirm.disableTitle", { name })}
          description={tt("confirm.disableBody")}
          submitLabel={tt("action.disable")}
          command="integration_disable"
          getBody={() => ({ connectorId })}
          successMessage={tt("report.commandOk", { message: tt("confirm.disableTitle", { name }) })}
          onClose={close}
        />
      ) : null}
      {open === "disconnect" ? (
        <CommandDialog
          title={tt("confirm.disconnectTitle", { name })}
          description={tt("confirm.disconnectBody")}
          submitLabel={tt("action.disconnect")}
          danger
          command="integration_disconnect"
          getBody={() => ({ connectorId })}
          successMessage={tt("report.commandOk", { message: tt("confirm.disconnectTitle", { name }) })}
          onClose={close}
        />
      ) : null}
      {open === "mode" ? (
        <CommandDialog
          title={tt("confirm.modeTitle", { name })}
          submitLabel={tt("confirm.apply")}
          command="integration_set_mode"
          getBody={() => ({ connectorId, mode })}
          canSubmit={mode !== connector.mode}
          danger={mode === "LIVE"}
          successMessage={tt("report.commandOk", { message: `${name}: ${label("mode", mode)}` })}
          onClose={close}
        >
          <Select label={tt("confirm.modeLabel")} value={mode} onChange={(e) => setMode(e.target.value)}>
            {CONNECTOR_MODES.map((m) => <option key={m} value={m} disabled={m === "LIVE" && !admin}>{label("mode", m)}{m === "LIVE" && !admin ? ` (${tt("common.adminOnly")})` : ""}</option>)}
          </Select>
          <p className="ic-muted">{tt("confirm.modeSandbox")}</p>
          <p className="ic-muted">{tt("confirm.modeLive")}</p>
          {mode === "LIVE" ? <Notice tone="warning">{tt("confirm.modeLiveWarning")}</Notice> : null}
        </CommandDialog>
      ) : null}
      {open === "trust" ? (
        <CommandDialog
          title={tt("confirm.trustTitle", { name })}
          submitLabel={tt("confirm.apply")}
          command="integration_set_trust"
          getBody={() => ({ connectorId, trust })}
          canSubmit={trust !== connector.trust}
          successMessage={tt("report.commandOk", { message: `${name}: ${label("trust", trust)}` })}
          onClose={close}
        >
          <Select label={tt("confirm.trustLabel")} value={trust} onChange={(e) => setTrust(e.target.value)}>
            {TRUST_STATES.map((s) => (
              <option key={s} value={s} disabled={!trustAllowed(connector.trust, s, admin)}>
                {label("trust", s)}{!trustAllowed(connector.trust, s, admin) ? ` (${tt("common.adminOnly")})` : ""}
              </option>
            ))}
          </Select>
          {admin ? null : <p className="ic-muted">{tt("confirm.trustRaiseNote")}</p>}
        </CommandDialog>
      ) : null}
    </div>
  );
}
