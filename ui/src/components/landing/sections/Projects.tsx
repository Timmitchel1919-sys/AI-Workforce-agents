import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import { useI18n } from "../../../i18n";
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
  const { t } = useI18n();
  return (
    <SectionContainer
      eyebrow={t("landing.v2.projects.eyebrow")}
      title={t("landing.v2.projects.title")}
      lede={t("landing.v2.projects.lede")}
    >
      <div className="lp2-projects">
        <GlassCard pad="md">
          <div className="lp2-tile-head">{t("landing.v2.projects.active")}</div>
          {projects.slice(0, 3).map((p) => (
            <div key={p.name} className="lp2-project-row">
              <span>{p.name}</span>
              <span className="meta">{p.meta}</span>
            </div>
          ))}
        </GlassCard>
        <GlassCard pad="md">
          <div className="lp2-tile-head">{t("landing.v2.projects.idle")}</div>
          {projects.slice(3).map((p) => (
            <div key={p.name} className="lp2-project-row">
              <span>{p.name}</span>
              <span className="meta">{p.meta}</span>
            </div>
          ))}
        </GlassCard>
        <GlassCard pad="md">
          <div className="lp2-tile-head">{t("landing.v2.projects.hour")}</div>
          <div className="lp2-project-row"><span>{t("landing.v2.projects.spend")}</span><span className="meta">$4.21</span></div>
          <div className="lp2-project-row"><span>{t("landing.v2.projects.deployments")}</span><span className="meta">2 ok</span></div>
          <div className="lp2-project-row"><span>{t("landing.v2.projects.approvals")}</span><span className="meta">1</span></div>
          <div className="lp2-project-row"><span>{t("landing.v2.projects.latency")}</span><span className="meta">1.2 s</span></div>
        </GlassCard>
      </div>
    </SectionContainer>
  );
}
export default Projects;
