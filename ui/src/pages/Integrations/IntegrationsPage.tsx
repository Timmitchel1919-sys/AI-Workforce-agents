import { useQuery } from "@tanstack/react-query";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { apiRequest } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { useI18n, type MessageKey } from "../../i18n";
import "../Operations/OperationsPage.css";

interface Registry {
  integrations: { id: string; category: string; name: string; registered: boolean; connection: "in_use" | "unverified" | "not_configured" }[];
  mcpServers: unknown[];
  webhooks: unknown[];
}

/**
 * Integration Hub (UI Layer 14). Lists only what the Control Plane reports.
 * No logo or name here is proof of a working connection.
 */
export default function IntegrationsPage() {
  const { t } = useI18n();
  const { accessToken } = useAuth();
  const reg = useQuery({
    queryKey: ["integrations", "registry", accessToken ?? "anonymous"],
    queryFn: () => apiRequest<Registry>("/api/integrations/registry", { accessToken }),
    retry: false,
  });
  return (
    <PageContainer variant="wide">
      <PageHeader eyebrow={t("common.brand")} title={t("integrationHub.title")} description={t("integrationHub.description")} />
      <p className="ops-muted">{t("integrationHub.gaps")}</p>
      {reg.error ? <p role="alert">{t("integrationHub.loadFailed")}</p> : null}
      {reg.data ? (
        <div className="ops-bento">
          {reg.data.integrations.map((i) => (
            <section key={i.id} className={`ops-card ops-status ops-status--${i.connection === "in_use" ? "healthy" : i.connection === "unverified" ? "degraded" : "unknown"}`}>
              <h2>{i.name}</h2>
              <p className="ops-muted">{i.category}</p>
              <p>{t(`integrationHub.connection.${i.connection}` as MessageKey)}</p>
            </section>
          ))}
          <section className="ops-card">
            <h2>{t("integrationHub.mcp")}</h2>
            <p className="ops-muted">{t("integrationHub.mcpNone")}</p>
          </section>
          <section className="ops-card">
            <h2>{t("integrationHub.webhooks")}</h2>
            <p className="ops-muted">{t("integrationHub.webhooksNone")}</p>
          </section>
        </div>
      ) : null}
    </PageContainer>
  );
}
