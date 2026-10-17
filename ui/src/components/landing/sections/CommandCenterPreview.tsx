import { CommandPanel, type CommandColumn, type CommandChip, type CommandSummary } from "../../primitives/CommandPanel";
import { SectionContainer } from "../../primitives/SectionContainer";
import { useI18n } from "../../../i18n";
import "./sections.css";

export function CommandCenterPreview({ inline = false }: { inline?: boolean }) {
  const { t } = useI18n();

  const columns: [CommandColumn, CommandColumn, CommandColumn] = [
    {
      heading: t("landing.v2.command.colProjects"),
      trailing: <span className="aw-cmd-chip cyan">{t("landing.v2.command.active")}</span>,
      items: [
        { id: "p1", label: "Atlas · Compliance Suite", meta: "orchestrator · Opus 4.7", state: "active" },
        { id: "p2", label: "Prism · Analytics Studio", meta: "deploy · 02:14",            state: "running" },
        { id: "p3", label: "Vector · Data Fabric",     meta: "idle",                      state: "idle" },
        { id: "p4", label: "Nova · Marketing OS",      meta: "idle",                      state: "idle" },
      ],
    },
    {
      heading: t("landing.v2.command.colAgents"),
      primary: true,
      items: [
        { id: "a1", label: "Architect",       meta: "step 3 of 7 · plan",       state: "running" },
        { id: "a2", label: "Developer × 4",   meta: "patch · src/api/*.ts",     state: "running" },
        { id: "a3", label: "QA Auditor",      meta: "diff review · 42 files",   state: "running" },
        { id: "a4", label: "Compliance Lead", meta: "awaiting approval",        state: "queued" },
        { id: "a5", label: "Deployer",        meta: "staging → prod",           state: "running" },
      ],
    },
    {
      heading: t("landing.v2.command.colQueue"),
      items: [
        { id: "q1", label: "Model route · GPT-5 → Opus 4.7", meta: "cost gate · OK", state: "active" },
        { id: "q2", label: "Tool exec · firebase.deploy",     meta: "sandbox",        state: "running" },
        { id: "q3", label: "Tool exec · github.pr.open",      meta: "sandbox",        state: "queued" },
        { id: "q4", label: "Approval · payment ≥ $100",       meta: "waiting · you",  state: "queued" },
      ],
    },
  ];

  const chips: CommandChip[] = [
    { label: t("landing.v2.command.chipBoundary"), tone: "ok" },
    { label: t("landing.v2.command.chipSpend"),    tone: "cyan" },
    { label: t("landing.v2.command.chipRouting"),  tone: "violet" },
    { label: t("landing.v2.command.chipDeploy"),   tone: "ok" },
    { label: t("landing.v2.command.chipApproval"), tone: "warn" },
  ];

  const summary: CommandSummary[] = [
    { label: t("landing.v2.command.sumProjects"), value: "4" },
    { label: t("landing.v2.command.sumAgents"),   value: "5" },
    { label: t("landing.v2.command.sumSpend"),    value: "$4.21/hr" },
    { label: t("landing.v2.command.sumApproval"), value: "1" },
  ];

  const panel = <CommandPanel columns={columns} footerChips={chips} mobileSummary={summary} />;

  if (inline) return panel;
  return (
    <SectionContainer
      eyebrow={t("landing.v2.command.eyebrow")}
      title={t("landing.v2.command.title")}
      lede={t("landing.v2.command.lede")}
    >
      {panel}
    </SectionContainer>
  );
}
export default CommandCenterPreview;
