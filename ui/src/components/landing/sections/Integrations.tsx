import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import "./sections.css";

const integrations = [
  "GitHub", "GitLab", "Firebase", "Google Cloud", "AWS", "Vercel",
  "Linear", "Jira", "Slack", "Notion", "Supabase", "PostgreSQL",
  "Anthropic", "OpenAI", "Vertex AI", "Figma",
];

export function Integrations() {
  return (
    <SectionContainer
      eyebrow="Tool fabric"
      title="Already speaks your systems."
      lede="Native tool adapters cover source, cloud, data, communication, and model providers. Each adapter runs inside the sandboxed tool fabric with policy and audit."
    >
      <GlassCard pad="md">
        <div className="lp2-integrations">
          {integrations.map((name) => (
            <div key={name} className="lp2-int">
              <span className="lp2-int-dot" aria-hidden />
              {name}
            </div>
          ))}
        </div>
      </GlassCard>
    </SectionContainer>
  );
}
export default Integrations;
