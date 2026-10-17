import { Lock, FileCheck, EyeOff, GitBranch, ScrollText, Fingerprint } from "lucide-react";
import { GlassCard } from "../../primitives/GlassCard";
import { SectionContainer } from "../../primitives/SectionContainer";
import "./sections.css";

const pillars = [
  { icon: Lock,        title: "Single-tenant boundary",   text: "Your workspace is isolated end-to-end. No shared models, no shared storage." },
  { icon: FileCheck,   title: "Signed every action",      text: "Every tool call, approval, and deployment is signed and immutable in the audit log." },
  { icon: EyeOff,      title: "Private by default",       text: "Access is invite-only. No public signup; no incidental sharing of workspace artifacts." },
  { icon: GitBranch,   title: "Policy gates",             text: "Spend caps, approval chains, and tool allowlists enforced server-side — not just in UI." },
  { icon: ScrollText,  title: "Full provenance",          text: "Every output links back to the prompt, model, tool chain, and reviewer that produced it." },
  { icon: Fingerprint, title: "Session attestation",      text: "WebAuthn + App Check gate every session; Firebase Auth under the hood." },
] as const;

export function Security() {
  return (
    <SectionContainer
      id="security"
      eyebrow="Security"
      title="Private operating system discipline."
      lede="AI Workforce is designed as a private, auditable system first. Every surface is instrumented so you can prove what happened and why."
    >
      <div className="lp2-sec">
        {pillars.map(({ icon: Icon, title, text }) => (
          <GlassCard key={title} pad="md">
            <div className="lp2-tile-head"><Icon size={14} aria-hidden /> policy</div>
            <h3 className="lp2-tile-title">{title}</h3>
            <p className="lp2-tile-text">{text}</p>
          </GlassCard>
        ))}
      </div>
    </SectionContainer>
  );
}
export default Security;
