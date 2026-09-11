import { useId } from "react";
import { Field, Input, Select } from "../../../components/ui";
import type { SelectOption } from "../../../components/ui";
import { describeStatus } from "../../../lib/status";
import {
  AGENT_STATUSES,
  type AgentFilters,
  type StatusFilter,
} from "../agentsView";

/**
 * Search + filter toolbar. Search is client-side over the already-loaded
 * registry (the `/agents` endpoint returns the full collection) — no per-
 * keystroke backend calls. Filter dimensions are only those the `AgentView`
 * contract actually carries: status, capability, project.
 */
export function AgentsToolbar({
  filters,
  onChange,
  capabilities,
  projects,
  resultCount,
}: {
  filters: AgentFilters;
  onChange: (next: AgentFilters) => void;
  capabilities: readonly string[];
  projects: readonly string[];
  resultCount: number;
}) {
  const id = useId();

  const statusOptions: SelectOption[] = [
    { value: "all", label: "All statuses" },
    ...AGENT_STATUSES.map((s) => ({
      value: s,
      label: describeStatus(s).label,
    })),
  ];
  const capabilityOptions: SelectOption[] = [
    { value: "all", label: "All capabilities" },
    ...capabilities.map((c) => ({ value: c, label: c })),
  ];
  const projectOptions: SelectOption[] = [
    { value: "all", label: "All projects" },
    ...projects.map((p) => ({ value: p, label: p })),
  ];

  return (
    <div
      className="ui-inline"
      role="search"
      aria-label="Filter agents"
      style={{ gap: "var(--space-md)", alignItems: "flex-end" }}
    >
      <Field
        label="Search agents"
        htmlFor={`${id}-search`}
        className="agents-toolbar__search"
      >
        <Input
          id={`${id}-search`}
          type="search"
          placeholder="Name, role, capability, or ID"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </Field>

      <Field label="Status" htmlFor={`${id}-status`}>
        <Select
          id={`${id}-status`}
          options={statusOptions}
          value={filters.status}
          onChange={(e) =>
            onChange({ ...filters, status: e.target.value as StatusFilter })
          }
        />
      </Field>

      <Field label="Capability" htmlFor={`${id}-capability`}>
        <Select
          id={`${id}-capability`}
          options={capabilityOptions}
          value={filters.capability}
          disabled={capabilities.length === 0}
          onChange={(e) => onChange({ ...filters, capability: e.target.value })}
        />
      </Field>

      <Field label="Project" htmlFor={`${id}-project`}>
        <Select
          id={`${id}-project`}
          options={projectOptions}
          value={filters.project}
          disabled={projects.length === 0}
          onChange={(e) => onChange({ ...filters, project: e.target.value })}
        />
      </Field>

      <p
        className="text-caption"
        aria-live="polite"
        style={{ paddingBottom: 6 }}
      >
        {resultCount} shown
      </p>
    </div>
  );
}
