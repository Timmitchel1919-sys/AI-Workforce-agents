import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import "./sections.css";

const steps = [
  { phase: "01 · intake",     name: "Project brief lands", desc: "Spec parsed; constraints and acceptance criteria extracted." },
  { phase: "02 · plan",       name: "Architect decomposes", desc: "Scope broken into tasks with model and tool budgets." },
  { phase: "03 · route",      name: "Model + agent routing", desc: "Each task gets the right role, model, and cost class." },
  { phase: "04 · execute",    name: "Sandboxed tool calls", desc: "Agents run inside a deterministic tool fabric with policy gates." },
  { phase: "05 · audit",      name: "Diff review + approvals", desc: "QA agents validate output; humans approve on gated actions." },
  { phase: "06 · deploy",     name: "Rollout + observability", desc: "Deployer ships, Ops watches, Finance tallies cost." },
] as const;

export function Workflow() {
  return (
    <SectionContainer
      id="workflow"
      eyebrow="Workflow"
      title="One pipeline. Every stage visible."
      lede="From intake to deploy, every step emits structured state the Command Center observes. No hidden hops, no magic — just a legible pipeline."
    >
      <GlassCard pad="md">
        <div className="lp2-workflow">
          {steps.map((s) => (
            <div key={s.phase} className="lp2-workflow-row">
              <b>{s.phase}</b>
              <p><strong style={{ color: "var(--foreground)" }}>{s.name}.</strong> {s.desc}</p>
              <span className="aw-cmd-chip cyan">live</span>
            </div>
          ))}
        </div>
      </GlassCard>
    </SectionContainer>
  );
}
export default Workflow;
