import { useMemo, useState, type ChangeEvent } from "react";
import { Download } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import {
  MAX_FILE_BYTES,
  correlation,
  groupSum,
  parseCsv,
  profileTable,
  profilesToCsv,
  type Table,
} from "../../features/analytics/dataProfile";
import { useI18n, type MessageKey } from "../../i18n";
import "../Operations/OperationsPage.css";

const fmt = (n: number | undefined) =>
  n === undefined ? "—" : Math.abs(n) >= 1e6 || (Math.abs(n) < 1e-3 && n !== 0) ? n.toExponential(3) : Number(n.toFixed(4)).toString();

/**
 * Analytics Studio (UI Layer 10). Real, deterministic analysis of a file the
 * owner picks, computed in the browser. Nothing is uploaded or persisted.
 */
export default function AnalyticsStudioPage() {
  const { t } = useI18n();
  const [table, setTable] = useState<Table | null>(null);
  const [file, setFile] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [group, setGroup] = useState(0);
  const [value, setValue] = useState(0);
  const [corrA, setCorrA] = useState(0);
  const [corrB, setCorrB] = useState(0);

  const profiles = useMemo(() => (table ? profileTable(table) : []), [table]);
  const numericIdx = profiles.map((p, i) => (p.type === "number" ? i : -1)).filter((i) => i >= 0);
  const textIdx = profiles.map((p, i) => (p.type === "text" ? i : -1)).filter((i) => i >= 0);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setError(null);
    setTable(null);
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) return setError("analyticsStudio.tooLarge");
    if (!/\.(csv|tsv|txt)$/i.test(f.name)) return setError("analyticsStudio.notCsv");
    try {
      const parsed = parseCsv(await f.text());
      if (parsed.columns.length === 0) return setError("analyticsStudio.parseFailed");
      setTable(parsed);
      setFile(f.name);
      const prof = profileTable(parsed);
      const nums = prof.map((p, i) => (p.type === "number" ? i : -1)).filter((i) => i >= 0);
      const texts = prof.map((p, i) => (p.type === "text" ? i : -1)).filter((i) => i >= 0);
      setGroup(texts[0] ?? 0);
      setValue(nums[0] ?? 0);
      setCorrA(nums[0] ?? 0);
      setCorrB(nums[1] ?? nums[0] ?? 0);
    } catch {
      setError("analyticsStudio.parseFailed");
    }
  };

  const grouped = table && textIdx.length && numericIdx.length ? groupSum(table, group, value) : null;
  const corr = table && numericIdx.length >= 2 ? correlation(table, corrA, corrB) : null;
  const maxSum = grouped ? Math.max(...grouped.groups.slice(0, 12).map((g) => Math.abs(g.sum)), 1) : 1;

  const exportCsv = () => {
    const blob = new Blob([profilesToCsv(profiles)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.replace(/\.[^.]+$/, "")}-profile.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const select = (label: MessageKey, val: number, set: (n: number) => void, idx: number[]) => (
    <label className="ops-field">
      <span>{t(label)}</span>
      <select value={val} onChange={(e) => set(Number(e.target.value))}>
        {idx.map((i) => (
          <option key={i} value={i}>{table!.columns[i]}</option>
        ))}
      </select>
    </label>
  );

  return (
    <PageContainer variant="wide">
      <PageHeader eyebrow={t("common.brand")} title={t("analyticsStudio.title")} description={t("analyticsStudio.description")} />
      <p className="ops-muted">{t("analyticsStudio.notPersisted")}</p>
      <section className="ops-card">
        <label className="ops-field">
          <span>{t("analyticsStudio.choose")}</span>
          <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void onFile(e)} />
        </label>
        {error ? <p role="alert">{t(error)}</p> : null}
        {table ? (
          <p role="status">
            {t("analyticsStudio.summary", { rows: table.rows.length, columns: table.columns.length, file })}
            {table.truncated ? ` · ${t("analyticsStudio.truncated")}` : ""}
          </p>
        ) : null}
      </section>

      {table ? (
        <>
          <section className="ops-card" style={{ marginTop: 12 }}>
            <h2>{t("analyticsStudio.profiles")}</h2>
            <p className="ops-muted">{t("analyticsStudio.missingNote")}</p>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    {(["name", "type", "missing", "unique", "invalid", "min", "max", "mean", "median", "std"] as const).map((c) => (
                      <th key={c} scope="col">{t(`analyticsStudio.columns.${c}` as MessageKey)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.name}>
                      <th scope="row">{p.name}</th>
                      <td>{p.type}</td>
                      <td>{p.missing} / {p.count}</td>
                      <td>{p.unique}</td>
                      <td>{p.invalid}</td>
                      <td>{fmt(p.min)}</td>
                      <td>{fmt(p.max)}</td>
                      <td>{fmt(p.mean)}</td>
                      <td>{fmt(p.median)}</td>
                      <td>{fmt(p.std)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="ui-button ghost" onClick={exportCsv}>
              <Download size={16} aria-hidden /> {t("analyticsStudio.export")}
            </button>
          </section>

          <div className="ops-bento" style={{ marginTop: 12 }}>
            {grouped ? (
              <section className="ops-card">
                <h2>{t("analyticsStudio.chart")}</h2>
                <div className="ops-filters">
                  {select("analyticsStudio.groupBy", group, setGroup, textIdx)}
                  {select("analyticsStudio.value", value, setValue, numericIdx)}
                </div>
                <svg role="img" aria-label={t("analyticsStudio.chart")} width="100%" height={grouped.groups.slice(0, 12).length * 26 + 4}>
                  {grouped.groups.slice(0, 12).map((g, i) => (
                    <g key={g.key} transform={`translate(0 ${i * 26})`}>
                      <text x="0" y="16" fontSize="12" fill="currentColor">{g.key.slice(0, 18)}</text>
                      <rect x="130" y="4" height="16" rx="3" width={`${(Math.abs(g.sum) / maxSum) * 55}%`} fill="var(--color-primary)" />
                    </g>
                  ))}
                </svg>
                <ul className="ops-list">
                  {grouped.groups.slice(0, 12).map((g) => (
                    <li key={g.key}>{g.key}: {fmt(g.sum)} (n = {g.n})</li>
                  ))}
                </ul>
                {grouped.skipped ? <p className="ops-muted">{t("analyticsStudio.skipped", { n: grouped.skipped })}</p> : null}
              </section>
            ) : null}
            {corr ? (
              <section className="ops-card">
                <h2>{t("analyticsStudio.correlation")}</h2>
                <div className="ops-filters">
                  {select("analyticsStudio.value", corrA, setCorrA, numericIdx)}
                  {select("analyticsStudio.value", corrB, setCorrB, numericIdx)}
                </div>
                <p>
                  {corr.r === null
                    ? t("analyticsStudio.corrInsufficient")
                    : t("analyticsStudio.corrResult", { r: corr.r.toFixed(3), n: corr.n })}
                </p>
              </section>
            ) : null}
          </div>
        </>
      ) : null}
    </PageContainer>
  );
}
