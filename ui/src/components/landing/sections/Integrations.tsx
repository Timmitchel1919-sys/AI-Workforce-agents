import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import { useI18n } from "../../../i18n";
import "./sections.css";

/** Vendor / product names are not translated. */
const integrations = [
  "GitHub", "GitLab", "Firebase", "Google Cloud", "AWS", "Vercel",
  "Linear", "Jira", "Slack", "Notion", "Supabase", "PostgreSQL",
  "Anthropic", "OpenAI", "Vertex AI", "Figma",
];

export function Integrations() {
  const { t } = useI18n();
  return (
    <SectionContainer
      eyebrow={t("landing.v2.integrations.eyebrow")}
      title={t("landing.v2.integrations.title")}
      lede={t("landing.v2.integrations.lede")}
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
