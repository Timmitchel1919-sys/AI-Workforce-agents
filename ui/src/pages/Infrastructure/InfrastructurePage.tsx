import { useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { CheckCircle2, Cpu, Lock, MinusCircle, Server, ShieldCheck, Wrench } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import {
  formatVersion,
  useEnvironmentDescriptors,
  useEnvironmentInstances,
  useHosts,
  useTools,
  type Availability,
  type CapabilityDeclaration,
  type EnvironmentDescriptor,
  type HostInstance,
  type InfrastructureState,
  type ToolItem,
  type TrustLevel,
} from "../../features/infrastructure";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import "../Approvals/ApprovalsPage.css";
import "../Projects/ExecutionPlan.css";
import "./InfrastructurePage.css";

type Tab = "environments" | "hosts" | "tools";

const AVAILABILITIES: readonly Availability[] = ["available", "degraded", "unavailable", "disabled"];
const KNOWN_CAPABILITIES = new Set([
  "command_execution_available",
  "container_runtime_available",
  "web_build_capable",
  "desktop_build_capable",
  "mobile_build_capable",
  "game_build_capable",
  "gpu_available",
]);
const KNOWN_HOST_TYPES = new Set(["local_workstation", "dedicated_runner", "cloud_runner", "container_host", "mac_build_host"]);

function tabOf(pathname: string): Tab {
  if (pathname.startsWith("/infrastructure/hosts")) return "hosts";
  if (pathname.startsWith("/infrastructure/tools")) return "tools";
  return "environments";
}

/** `visual_studio_code` → `visual studio code` (identifiers only, never translated names). */
function humanize(id: string): string {
  return id.replace(/_/g, " ");
}

function matches(query: string, ...values: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || values.some((value) => value?.toLowerCase().includes(q));
}

/**
 * Infrastructure: supported environment types, detected installations,
 * registered hosts and the tool registry — read-only, straight from the
 * Control Plane. Empty registries are shown as empty; nothing is simulated.
 */
export default function InfrastructurePage() {
  const { t } = useI18n();
  const tab = tabOf(useLocation().pathname);

  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={t("infrastructure.title")} description={t("infrastructure.description")} />
      <nav className="plan-tabs" aria-label={t("infrastructure.tabs")}>
        <NavLink to="/infrastructure" end className="plan-tab">
          {t("infrastructure.tabEnvironments")}
        </NavLink>
        <NavLink to="/infrastructure/hosts" className="plan-tab">
          {t("infrastructure.tabHosts")}
        </NavLink>
        <NavLink to="/infrastructure/tools" className="plan-tab">
          {t("infrastructure.tabTools")}
        </NavLink>
      </nav>
      {tab === "hosts" ? <HostsTab /> : tab === "tools" ? <ToolsTab /> : <EnvironmentsTab />}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                      */
/* ------------------------------------------------------------------ */

function StateGate({
  state,
  refetch,
  empty,
  children,
}: {
  state: InfrastructureState;
  refetch: () => void;
  empty: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (state === "loading") {
    return (
      <div className="gov-list" role="status" aria-label={t("infrastructure.loading")}>
        <Skeleton height={88} width="100%" />
        <Skeleton height={88} width="100%" />
      </div>
    );
  }
  if (state === "forbidden" || state === "unauthenticated") {
    return (
      <ErrorState
        icon={<Lock size={28} />}
        title={t(state === "forbidden" ? "infrastructure.forbiddenTitle" : "infrastructure.unauthenticatedTitle")}
        description={t(state === "forbidden" ? "infrastructure.forbiddenDescription" : "infrastructure.unauthenticatedDescription")}
      />
    );
  }
  if (state === "unavailable") {
    return (
      <ErrorState
        title={t("infrastructure.errorTitle")}
        description={t("infrastructure.errorDescription")}
        onRetry={refetch}
        retryLabel={t("common.retry")}
      />
    );
  }
  if (state === "empty") return <>{empty}</>;
  return <>{children}</>;
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="infra-section" aria-label={title}>
      <header className="infra-section__header">
        <h2 className="infra-section__title">{title}</h2>
        <p className="gov-muted">{description}</p>
      </header>
      {children}
    </section>
  );
}

function AvailabilityPill({ value }: { value: Availability }) {
  const { t } = useI18n();
  const tone = value === "available" ? "positive" : value === "degraded" ? "warning" : "negative";
  return <span className={`gov-pill gov-pill--${tone}`}>{t(`infrastructure.availability.${value}` as MessageKey)}</span>;
}

function TrustPill({ value }: { value: TrustLevel }) {
  const { t } = useI18n();
  return (
    <span className={`gov-pill ${value === "verified" ? "gov-pill--positive" : "gov-pill--neutral"}`}>
      {value === "verified" ? <ShieldCheck size={12} aria-hidden /> : null}
      {t(`infrastructure.trust.${value}` as MessageKey)}
    </span>
  );
}

function useCapabilityLabel() {
  const { t } = useI18n();
  return (id: string) => (KNOWN_CAPABILITIES.has(id) ? t(`infrastructure.capability.${id}` as MessageKey) : humanize(id));
}

function CapabilityList({ capabilities }: { capabilities: readonly CapabilityDeclaration[] }) {
  const { t } = useI18n();
  const label = useCapabilityLabel();
  if (capabilities.length === 0) return <p className="gov-muted">{t("infrastructure.noCapabilities")}</p>;
  return (
    <ul className="infra-capabilities">
      {capabilities.map((c) => (
        <li key={c.capability} className={c.available ? "is-available" : "is-unavailable"}>
          {c.available ? <CheckCircle2 size={14} aria-hidden /> : <MinusCircle size={14} aria-hidden />}
          <span>
            {label(c.capability)}
            <span className="sr-only">
              {" "}
              — {t(c.available ? "infrastructure.capabilityAvailable" : "infrastructure.capabilityUnavailable")}
            </span>
          </span>
          {c.evidence ? <span className="infra-evidence">{t("infrastructure.evidence", { evidence: c.evidence })}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Timestamps({ detected, verified }: { detected?: string; verified?: string }) {
  const { t, language } = useI18n();
  const parts = [
    detected ? t("infrastructure.lastDetected", { time: formatDateTime(detected, language) ?? detected }) : undefined,
    verified ? t("infrastructure.lastVerified", { time: formatDateTime(verified, language) ?? verified }) : undefined,
  ].filter(Boolean);
  return parts.length ? <p className="gov-muted">{parts.join(" · ")}</p> : null;
}

function SearchField({ value, onChange, children }: { value: string; onChange: (v: string) => void; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="gov-filters infra-filters">
      <label className="gov-field">
        <span>{t("infrastructure.search")}</span>
        <input type="search" value={value} maxLength={80} placeholder={t("infrastructure.searchPlaceholder")} onChange={(e) => onChange(e.target.value)} />
      </label>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Environments                                                       */
/* ------------------------------------------------------------------ */

function EnvironmentsTab() {
  const { t } = useI18n();
  const instances = useEnvironmentInstances();
  const descriptors = useEnvironmentDescriptors();
  const hosts = useHosts();
  const [query, setQuery] = useState("");
  const descriptorById = useMemo(() => new Map(descriptors.items.map((d) => [d.id, d])), [descriptors.items]);
  const hostById = useMemo(() => new Map(hosts.items.map((h) => [h.hostId, h])), [hosts.items]);

  const shownInstances = instances.items.filter((i) => matches(query, i.name, i.environmentType, i.id, hostById.get(i.hostId)?.name));
  const shownDescriptors = descriptors.items.filter((d) => matches(query, d.name, d.environmentType, d.id, d.description));

  return (
    <>
      <SearchField value={query} onChange={setQuery} />

      <Section title={t("infrastructure.instancesTitle")} description={t("infrastructure.instancesDescription")}>
        <StateGate
          state={instances.state}
          refetch={instances.refetch}
          empty={<EmptyState title={t("infrastructure.instancesEmptyTitle")} description={t("infrastructure.instancesEmptyDescription")} />}
        >
          {shownInstances.length === 0 ? (
            <p className="gov-muted">{t("infrastructure.noMatches")}</p>
          ) : (
            <ul className="infra-grid">
              {shownInstances.map((instance) => {
                const host = hostById.get(instance.hostId);
                const version = formatVersion(instance.version);
                return (
                  <li key={instance.id} className="gov-card infra-card">
                    <div className="gov-card__head">
                      <Cpu size={16} aria-hidden />
                      <strong className="infra-card__title">{instance.name}</strong>
                      <AvailabilityPill value={instance.availability} />
                      <TrustPill value={instance.trustLevel} />
                    </div>
                    <dl className="infra-facts">
                      <div>
                        <dt>{t("infrastructure.type")}</dt>
                        <dd>{descriptorById.get(instance.descriptorId)?.name ?? humanize(instance.environmentType)}</dd>
                      </div>
                      {version ? (
                        <div>
                          <dt>{t("infrastructure.version")}</dt>
                          <dd>{version}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>{t("infrastructure.host")}</dt>
                        <dd>{host?.name ?? t("infrastructure.unknownHost", { id: instance.hostId })}</dd>
                      </div>
                    </dl>
                    <div>
                      <span className="infra-label">{t("infrastructure.toolchains")}</span>
                      {instance.toolchains.length === 0 ? (
                        <p className="gov-muted">{t("infrastructure.noToolchains")}</p>
                      ) : (
                        <ul className="infra-chips">
                          {instance.toolchains.map((tc) => (
                            <li key={`${tc.kind}:${tc.name}`} className="infra-chip">
                              {tc.name}
                              {tc.version ? ` ${formatVersion(tc.version)}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <span className="infra-label">{t("infrastructure.capabilities")}</span>
                      <CapabilityList capabilities={instance.capabilities} />
                    </div>
                    <Timestamps detected={instance.lastDetectedAt} verified={instance.lastVerifiedAt} />
                  </li>
                );
              })}
            </ul>
          )}
        </StateGate>
      </Section>

      <Section title={t("infrastructure.descriptorsTitle")} description={t("infrastructure.descriptorsDescription")}>
        <StateGate
          state={descriptors.state}
          refetch={descriptors.refetch}
          empty={<EmptyState title={t("infrastructure.descriptorsEmpty")} />}
        >
          {shownDescriptors.length === 0 ? (
            <p className="gov-muted">{t("infrastructure.noMatches")}</p>
          ) : (
            <ul className="infra-grid infra-grid--compact">
              {shownDescriptors.map((descriptor) => (
                <DescriptorCard key={descriptor.id} descriptor={descriptor} />
              ))}
            </ul>
          )}
        </StateGate>
      </Section>
    </>
  );
}

function DescriptorCard({ descriptor }: { descriptor: EnvironmentDescriptor }) {
  const { t } = useI18n();
  const label = useCapabilityLabel();
  const os = descriptor.minimumOs;
  return (
    <li className="gov-card infra-card">
      <div className="gov-card__head">
        <strong className="infra-card__title">{descriptor.name}</strong>
        <code className="gov-action">{descriptor.environmentType}</code>
      </div>
      <p className="infra-card__description">{descriptor.description}</p>
      {descriptor.supportedToolchains.length > 0 ? (
        <div>
          <span className="infra-label">{t("infrastructure.toolchains")}</span>
          <ul className="infra-chips">
            {descriptor.supportedToolchains.map((tc) => (
              <li key={tc.kind} className="infra-chip">
                {humanize(tc.kind)}
                {tc.minimum ? ` ${t("infrastructure.atLeast", { version: formatVersion(tc.minimum) ?? "" })}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {descriptor.requiredCapabilities.length > 0 ? (
        <div>
          <span className="infra-label">{t("infrastructure.requiredCapabilities")}</span>
          <ul className="infra-chips">
            {descriptor.requiredCapabilities.map((c) => (
              <li key={c} className="infra-chip">
                {label(c)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="gov-muted">
        {t("infrastructure.minimumOs")}:{" "}
        {os?.os || os?.architecture ? [os.os, os.architecture].filter(Boolean).join(" · ") : t("infrastructure.anyPlatform")}
      </p>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Hosts                                                              */
/* ------------------------------------------------------------------ */

function HostsTab() {
  const { t } = useI18n();
  const hosts = useHosts();
  const instances = useEnvironmentInstances();
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<Availability | "">("");
  const countByHost = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of instances.items) counts.set(i.hostId, (counts.get(i.hostId) ?? 0) + 1);
    return counts;
  }, [instances.items]);
  const shown = hosts.items.filter(
    (h) => (!availability || h.availability === availability) && matches(query, h.name, h.hostId, h.hostType, h.os.os),
  );

  return (
    <>
      <SearchField value={query} onChange={setQuery}>
        <label className="gov-field">
          <span>{t("infrastructure.availabilityFilter")}</span>
          <select value={availability} onChange={(e) => setAvailability(e.target.value as Availability | "")}>
            <option value="">{t("infrastructure.allAvailability")}</option>
            {AVAILABILITIES.map((a) => (
              <option key={a} value={a}>
                {t(`infrastructure.availability.${a}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
      </SearchField>
      <Section title={t("infrastructure.hostsTitle")} description={t("infrastructure.hostsDescription")}>
        <StateGate
          state={hosts.state}
          refetch={hosts.refetch}
          empty={<EmptyState title={t("infrastructure.hostsEmptyTitle")} description={t("infrastructure.hostsEmptyDescription")} />}
        >
          {shown.length === 0 ? (
            <p className="gov-muted">{t("infrastructure.noMatches")}</p>
          ) : (
            <ul className="infra-grid">
              {shown.map((host) => (
                <HostCard key={host.id} host={host} installations={countByHost.get(host.hostId) ?? 0} />
              ))}
            </ul>
          )}
        </StateGate>
      </Section>
    </>
  );
}

function HostCard({ host, installations }: { host: HostInstance; installations: number }) {
  const { t } = useI18n();
  const os = [host.os.os, host.os.version, host.os.architecture].filter(Boolean).join(" · ");
  return (
    <li className="gov-card infra-card">
      <div className="gov-card__head">
        <Server size={16} aria-hidden />
        <strong className="infra-card__title">{host.name}</strong>
        <AvailabilityPill value={host.availability} />
        <TrustPill value={host.trustLevel} />
      </div>
      <dl className="infra-facts">
        <div>
          <dt>{t("infrastructure.type")}</dt>
          <dd>{KNOWN_HOST_TYPES.has(host.hostType) ? t(`infrastructure.hostType.${host.hostType}` as MessageKey) : humanize(host.hostType)}</dd>
        </div>
        <div>
          <dt>{t("infrastructure.os")}</dt>
          <dd>{os}</dd>
        </div>
        <div>
          <dt>{t("infrastructure.tabEnvironments")}</dt>
          <dd>{t("infrastructure.installationsOnHost", { count: installations })}</dd>
        </div>
      </dl>
      <div>
        <span className="infra-label">{t("infrastructure.capabilities")}</span>
        <CapabilityList capabilities={host.capabilities} />
      </div>
      <Timestamps detected={host.lastDetectedAt} verified={host.lastVerifiedAt} />
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Tools                                                              */
/* ------------------------------------------------------------------ */

function ToolsTab() {
  const { t } = useI18n();
  const tools = useTools();
  const [query, setQuery] = useState("");
  const shown = tools.items.filter((tool) => matches(query, tool.name, tool.toolId, tool.requiredPermission, ...tool.capabilities));

  return (
    <>
      <SearchField value={query} onChange={setQuery} />
      <Section title={t("infrastructure.toolsTitle")} description={t("infrastructure.toolsDescription")}>
        <StateGate
          state={tools.state}
          refetch={tools.refetch}
          empty={<EmptyState title={t("infrastructure.toolsEmptyTitle")} description={t("infrastructure.toolsEmptyDescription")} />}
        >
          {shown.length === 0 ? (
            <p className="gov-muted">{t("infrastructure.noMatches")}</p>
          ) : (
            <ul className="infra-grid">
              {shown.map((tool) => (
                <ToolCard key={tool.toolId} tool={tool} />
              ))}
            </ul>
          )}
        </StateGate>
      </Section>
    </>
  );
}

function ToolCard({ tool }: { tool: ToolItem }) {
  const { t } = useI18n();
  const scope = (values: readonly string[], restrictedEmpty: MessageKey) =>
    values.includes("*") ? t("infrastructure.any") : values.length === 0 ? t(restrictedEmpty) : values.join(", ");
  return (
    <li className="gov-card infra-card">
      <div className="gov-card__head">
        <Wrench size={16} aria-hidden />
        <strong className="infra-card__title">{tool.name}</strong>
        <span className="gov-muted">v{tool.version}</span>
        <span className={`gov-pill ${tool.approvalRequired ? "gov-pill--warning" : "gov-pill--neutral"}`}>
          {t(tool.approvalRequired ? "infrastructure.approvalRequired" : "infrastructure.noApproval")}
        </span>
      </div>
      <code className="gov-action">{tool.toolId}</code>
      {tool.capabilities.length > 0 ? (
        <ul className="infra-chips">
          {tool.capabilities.map((c) => (
            <li key={c} className="infra-chip">
              {c}
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="infra-facts">
        <div>
          <dt>{t("infrastructure.permission")}</dt>
          <dd>{tool.requiredPermission}</dd>
        </div>
        <div>
          <dt>{t("infrastructure.allowedAgents")}</dt>
          <dd>{scope(tool.allowedAgents, "infrastructure.noneInScope")}</dd>
        </div>
        <div>
          <dt>{t("infrastructure.allowedProjects")}</dt>
          <dd>{scope(tool.allowedProjects, "infrastructure.noneInScope")}</dd>
        </div>
        <div>
          <dt>{t("infrastructure.allowedEnvironments")}</dt>
          <dd>{scope(tool.allowedEnvironments, "infrastructure.noneInScope")}</dd>
        </div>
      </dl>
      <p className="gov-muted">
        {t("infrastructure.executions")}:{" "}
        {tool.stats.total === 0 ? t("infrastructure.noExecutions") : t("infrastructure.statsSummary", { ...tool.stats })}
      </p>
    </li>
  );
}
