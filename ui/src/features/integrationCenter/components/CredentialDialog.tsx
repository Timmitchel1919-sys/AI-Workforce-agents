import { useState, type FormEvent } from "react";
import { Button, Dialog, Input, Select } from "../../../components/ui";
import { useUncachedCommand } from "../hooks/useIntegrations";
import { useT } from "../lib/useT";
import { CREDENTIAL_KINDS } from "../types";
import { ErrorPanel, Notice } from "./common";
import { useReport } from "./report";

interface CredentialDialogProps {
  connectorId: string;
  connectorName: string;
  /** "primary" stores the connector credential, "webhook" stores the webhook signing secret. */
  purpose: "primary" | "webhook";
  /** False when the server has no vault key: credentials cannot be stored. */
  canStore: boolean;
  oauthConnector: boolean;
  onClose: () => void;
}

/**
 * The only place a secret is typed. The value lives in ONE password field, is sent in the single store command and the
 * field is cleared the moment it is submitted. It is never rendered, logged, put in a URL, kept in a query cache or
 * written to browser storage, and nothing returned by the server is echoed beside it. Mount only while open.
 */
export function CredentialDialog({ connectorId, connectorName, purpose, canStore, oauthConnector, onClose }: CredentialDialogProps) {
  const { tt, label } = useT();
  const { report } = useReport();
  const send = useUncachedCommand();
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<string>("token");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const webhook = purpose === "webhook";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canStore || value.length === 0 || pending) return;
    const secret = value;
    setValue(""); // cleared before the request even leaves
    setPending(true);
    setError(null);
    send("integration_store_credential", { connectorId, purpose, ...(webhook ? {} : { kind }), value: secret })
      .then(() => {
        report({ tone: "success", message: tt(webhook ? "credential.webhookStored" : "credential.stored", { name: connectorName }) });
        onClose();
      })
      .catch((e: unknown) => {
        setError(e);
        setPending(false);
      });
  };

  return (
    <Dialog open onClose={onClose} title={tt(webhook ? "credential.webhookTitle" : "credential.title", { name: connectorName })}>
      <form className="ic-form" onSubmit={submit} autoComplete="off">
        <p className="ic-muted">{tt(webhook ? "credential.webhookExplainer" : "credential.explainer")}</p>
        {oauthConnector && !webhook ? <Notice>{tt("credential.oauthNote")}</Notice> : null}
        {!canStore ? <Notice tone="warning">{tt("credential.noVault")}</Notice> : null}
        {webhook ? null : (
          <Select label={tt("credential.kind")} value={kind} onChange={(e) => setKind(e.target.value)} disabled={!canStore}>
            {CREDENTIAL_KINDS.map((k) => <option key={k} value={k}>{label("credentialKind", k)}</option>)}
          </Select>
        )}
        <Input
          label={tt(webhook ? "credential.webhookValueLabel" : "credential.valueLabel")}
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          autoFocus
          required
          disabled={!canStore || pending}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {error ? <ErrorPanel error={error} /> : null}
        <div className="ic-actions">
          <Button type="submit" variant="primary" loading={pending} disabled={!canStore || value.length === 0}>
            {tt(webhook ? "credential.submitWebhook" : "credential.submit")}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>{tt("common.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
