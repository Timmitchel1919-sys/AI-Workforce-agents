import { useI18n } from "../../../i18n";
import type { FilterId, FilterOption } from "../lib/graphModel";
import { filterLabel } from "../lib/labels";

interface Props {
  options: readonly FilterOption[];
  active: FilterId;
  onChange: (filter: FilterId) => void;
}

export function GraphFilters({ options, active, onChange }: Props) {
  const { t } = useI18n();
  return (
    <div className="sg-filters" role="group" aria-label={t("spatial.filters.label")}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="sg-chip"
          aria-pressed={active === o.id}
          onClick={() => onChange(o.id)}
        >
          {filterLabel(t, o.id)} <span className="sg-chip__count">({o.count})</span>
        </button>
      ))}
    </div>
  );
}
