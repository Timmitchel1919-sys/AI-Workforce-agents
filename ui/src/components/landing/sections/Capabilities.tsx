import {
  Cpu, Workflow, GitBranch, Shield, Gauge, Boxes,
} from "lucide-react";
import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import "./sections.css";

const tiles = [
  { icon: Cpu,      head: "Orchestrator",   title: "Autonomous planning",   text: "Decomposes projects into tasks, routes to agents, and reconciles state across runs." },
  { icon: Workflow, head: "Model routing",  title: "Right model, right task", text: "Cost- and capability-aware routing across Opus, Sonnet, Haiku, and your private models." },
  { icon: GitBranch,head: "Tool fabric",    title: "Deterministic execution", text: "Sandboxed tool calls — git, GCP, Firebase, custom APIs — every action captured in the audit log." },
  { icon: Shield,   head: "Boundary",       title: "Private by default",     text: "Single-tenant architecture. Your data stays on your infrastructure." },
  { icon: Gauge,    head: "Observability",  title: "Real system state",      text: "Live spend, latency, approvals, and deployments — not after-the-fact logs." },
  { icon: Boxes,    head: "Projects",       title: "Composable OS",          text: "Each project is a workspace of agents, tools, environments, and policies — reusable, versioned." },
] as const;

export function Capabilities() {
  return (
    <SectionContainer
      id="capabilities"
      eyebrow="Capabilities"
      title="An operating system, not a chatbot."
      lede="AI Workforce coordinates agents, models, tools, and environments the way an operating system coordinates processes — with precedence, isolation, and auditability."
    >
      <div className="lp2-bento">
        {tiles.map(({ icon: Icon, head, title, text }) => (
          <GlassCard key={title} pad="md">
            <div className="lp2-tile-head"><Icon size={14} aria-hidden /> {head}</div>
            <h3 className="lp2-tile-title">{title}</h3>
            <p className="lp2-tile-text">{text}</p>
          </GlassCard>
        ))}
      </div>
    </SectionContainer>
  );
}
export default Capabilities;
