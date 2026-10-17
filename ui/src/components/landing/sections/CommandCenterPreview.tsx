import { CommandPanel } from "../../primitives/CommandPanel";
import { SectionContainer } from "../../primitives/SectionContainer";
import "./sections.css";

const columns = [
  {
    heading: "Projects",
    trailing: <span className="aw-cmd-chip cyan">active</span>,
    items: [
      { id: "p1", label: "Atlas · Compliance Suite", meta: "orchestrator · Opus 4.7", state: "active" as const },
      { id: "p2", label: "Prism · Analytics Studio",  meta: "deploy · 02:14", state: "running" as const },
      { id: "p3", label: "Vector · Data Fabric",      meta: "idle",            state: "idle" as const },
      { id: "p4", label: "Nova · Marketing OS",       meta: "idle",            state: "idle" as const },
    ],
  },
  {
    heading: "Running agents",
    items: [
      { id: "a1", label: "Architect",      meta: "step 3 of 7 · plan",        state: "running" as const },
      { id: "a2", label: "Developer × 4",  meta: "patch · src/api/*.ts",      state: "running" as const },
      { id: "a3", label: "QA Auditor",     meta: "diff review · 42 files",    state: "running" as const },
      { id: "a4", label: "Compliance Lead",meta: "awaiting human approval",   state: "queued" as const },
      { id: "a5", label: "Deployer",       meta: "staging → prod",            state: "running" as const },
    ],
  },
  {
    heading: "Queue · routing",
    items: [
      { id: "q1", label: "Model route · GPT-5 → Opus 4.7", meta: "cost gate · OK", state: "active" as const },
      { id: "q2", label: "Tool exec · firebase.deploy",     meta: "sandbox",       state: "running" as const },
      { id: "q3", label: "Tool exec · github.pr.open",      meta: "sandbox",       state: "queued" as const },
      { id: "q4", label: "Approval · payment ≥ $100",        meta: "waiting · you", state: "queued" as const },
    ],
  },
] as const;

const chips = [
  { label: "SOC boundary · armed", tone: "ok" as const },
  { label: "Spend · $4.21 / hr",   tone: "cyan" as const },
  { label: "Model routing · fast", tone: "violet" as const },
  { label: "Deploy · ok",          tone: "ok" as const },
  { label: "1 approval waiting",   tone: "warn" as const },
];

export function CommandCenterPreview({ inline = false }: { inline?: boolean }) {
  const panel = (
    <CommandPanel
      columns={columns as unknown as Parameters<typeof CommandPanel>[0]["columns"]}
      footerChips={chips}
    />
  );
  if (inline) return panel;
  return (
    <SectionContainer
      id="capabilities"
      eyebrow={<>Command center</>}
      title="Everything the workforce is doing — in one view."
      lede="The system owns orchestration end to end: active projects, running agents, model routing, tool execution, approvals, and spend. No chatbot UX."
    >
      {panel}
    </SectionContainer>
  );
}
export default CommandCenterPreview;
