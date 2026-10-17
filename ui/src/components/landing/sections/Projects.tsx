import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import "./sections.css";

const projects = [
  { name: "Atlas · Compliance Suite", meta: "7 agents · 48 tasks · 02:14 run"  },
  { name: "Prism · Analytics Studio", meta: "4 agents · 12 tasks · deploying"  },
  { name: "Vector · Data Fabric",     meta: "2 agents · 6 tasks · scheduled"   },
  { name: "Nova · Marketing OS",      meta: "3 agents · 9 tasks · idle"        },
  { name: "Oracle · Research",        meta: "1 agent  · 4 tasks · running"     },
  { name: "Harbor · Deploy Runner",   meta: "ops · 24h window · ok"            },
];

export function Projects() {
  return (
    <SectionContainer
      eyebrow="Projects"
      title="Composable workspaces, each with their own policies."
      lede="Projects aren't folders. Each one is a workspace of agents, tools, approvals, and spend — versioned and auditable like code."
    >
      <div className="lp2-projects">
        <GlassCard pad="md">
          <div className="lp2-tile-head">active</div>
          {projects.slice(0, 3).map((p) => (
            <div key={p.name} className="lp2-project-row">
              <span>{p.name}</span>
              <span className="meta">{p.meta}</span>
            </div>
          ))}
        </GlassCard>
        <GlassCard pad="md">
          <div className="lp2-tile-head">idle</div>
          {projects.slice(3).map((p) => (
            <div key={p.name} className="lp2-project-row">
              <span>{p.name}</span>
              <span className="meta">{p.meta}</span>
            </div>
          ))}
        </GlassCard>
        <GlassCard pad="md">
          <div className="lp2-tile-head">this hour</div>
          <div className="lp2-project-row"><span>Spend</span><span className="meta">$4.21</span></div>
          <div className="lp2-project-row"><span>Deployments</span><span className="meta">2 ok</span></div>
          <div className="lp2-project-row"><span>Approvals waiting</span><span className="meta">1</span></div>
          <div className="lp2-project-row"><span>Latency p95</span><span className="meta">1.2 s</span></div>
        </GlassCard>
      </div>
    </SectionContainer>
  );
}
export default Projects;
