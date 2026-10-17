import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { GlassButton } from "../../ui/GlassButton";
import { GlassCard } from "../../primitives/GlassCard";
import { GlowBorder } from "../../primitives/GlowBorder";
import { SectionContainer } from "../../primitives/SectionContainer";
import "./sections.css";

export function FinalCTA() {
  return (
    <SectionContainer>
      <GlowBorder radius={22}>
        <GlassCard pad="lg" elevation="elevated">
          <div className="lp2-cta-shell">
            <h2 className="lp2-cta-title">Enter the Command Center.</h2>
            <p className="lp2-cta-sub">Access is invite-only. If your invitation is active, sign in to continue.</p>
            <div className="lp2-cta-row">
              <Link to="/login" style={{ textDecoration: "none" }}>
                <GlassButton size="lg" variant="premium" rightIcon={<ArrowRight size={16} />}>
                  Sign in
                </GlassButton>
              </Link>
            </div>
          </div>
        </GlassCard>
      </GlowBorder>
    </SectionContainer>
  );
}
export default FinalCTA;
