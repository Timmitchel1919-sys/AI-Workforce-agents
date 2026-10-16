import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { Skeleton } from "../../components/ui";
import { useI18n, type MessageKey } from "../../i18n";

export type StageMode = "automated" | "manual" | "awaiting_approval" | "not_configured" | "unavailable";

export interface FactoryPipeline {
  stages: { stage: string; mode: StageMode; reason: string }[];
  runners: { family: string; status: string; realRunners: number }[];
}

/**
 * UI Layer 5 — the development pipeline exactly as the Control Plane reports
 * this deployment can run it. Mode is never inferred in the browser.
 */
export function FactoryPipelinePanel() {
  const { t } = useI18n();
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: ["softwareFactory", "pipeline", accessToken ?? "anonymous"],
    queryFn: () => apiRequest<FactoryPipeline>("/api/software-factory/pipeline", { accessToken }),
    retry: false,
    staleTime: 30_000,
  });
  // A malformed payload is a failure, never an empty (and so falsely calm) pipeline.
  const data = query.data && Array.isArray(query.data.stages) && Array.isArray(query.data.runners) ? query.data : undefined;
  const failed = Boolean(query.error) || (query.isSuccess && !data);
  const runners = data?.runners.filter((r) => r.realRunners > 0) ?? [];

  return (
    <section className="fp-panel" aria-labelledby="fp-title">
      <div className="fp-head">
        <h2 id="fp-title">{t("factoryPipeline.title")}</h2>
        <Link to="/workflow-studio">{t("factoryPipeline.openStudio")}</Link>
      </div>
      <p className="fp-muted">{t("factoryPipeline.intro")}</p>
      {query.isLoading ? <Skeleton height={80} /> : null}
      {failed ? <p role="alert">{t("factoryPipeline.loadFailed")}</p> : null}
      {data ? (
        <>
          <ol className="fp-stages">
            {data.stages.map((s) => (
              <li key={s.stage} className={`fp-stage fp-stage--${s.mode}`}>
                <span className="fp-stage__name">{t(`factoryPipeline.stages.${s.stage}` as MessageKey)}</span>
                <span className="fp-stage__mode">{t(`factoryPipeline.modes.${s.mode}` as MessageKey)}</span>
                <span className="fp-stage__reason">{t(`factoryPipeline.reasons.${s.reason}` as MessageKey)}</span>
              </li>
            ))}
          </ol>
          <h3>{t("factoryPipeline.runners")}</h3>
          {runners.length === 0 ? (
            <p className="fp-muted">{t("factoryPipeline.noRunners")}</p>
          ) : (
            <ul className="fp-runners">
              {runners.map((r) => (
                <li key={r.family}>
                  {r.family} · {r.status} · {t("factoryPipeline.realRunners", { count: r.realRunners })}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
