import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import "./sections.css";

const departments = [
  { code: "CPA", name: "Chief Project Architect", meta: "Decomposition · planning · scope" },
  { code: "DEV", name: "Development",             meta: "Patch · refactor · migrate" },
  { code: "QA",  name: "Quality & Audit",         meta: "Diff review · tests · policy" },
  { code: "SEC", name: "Security",                meta: "SBOM · boundary · incidents" },
  { code: "RES", name: "Research",                meta: "Discovery · benchmarks" },
  { code: "UX",  name: "Design",                  meta: "Specs · tokens · motion" },
  { code: "OPS", name: "Operations",              meta: "Deploy · observability" },
  { code: "FIN", name: "Finance",                 meta: "Cost gates · approvals" },
] as const;

export function Departments() {
  return (
    <SectionContainer
      id="workforce"
      eyebrow="Workforce"
      title="Specialist departments, not a single assistant."
      lede="Each department is a bounded role with its own prompts, tools, and policies. The orchestrator routes work by capability, not by vibe."
    >
      <div className="lp2-bento">
        {departments.map((d) => (
          <GlassCard key={d.code} pad="md">
            <div className="lp2-tile-head">{d.code}</div>
            <h3 className="lp2-tile-title">{d.name}</h3>
            <p className="lp2-tile-text">{d.meta}</p>
          </GlassCard>
        ))}
      </div>
    </SectionContainer>
  );
}
export default Departments;
