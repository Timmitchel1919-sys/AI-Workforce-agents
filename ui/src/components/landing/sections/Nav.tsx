import { Link } from "react-router-dom";
import { GlassButton } from "../../ui/GlassButton";
import "./sections.css";

const links = [
  { id: "capabilities", label: "Capabilities" },
  { id: "workforce", label: "Workforce" },
  { id: "workflow", label: "Workflow" },
  { id: "security", label: "Security" },
];

export function Nav() {
  return (
    <nav className="lp2-nav" aria-label="Primary">
      <Link to="/" className="lp2-brand" aria-label="AI Workforce home">
        <span className="lp2-brand-dot" aria-hidden />
        <span>AI Workforce</span>
      </Link>
      <ul className="lp2-nav-links">
        {links.map((l) => (
          <li key={l.id}>
            <a href={`#${l.id}`}>{l.label}</a>
          </li>
        ))}
      </ul>
      <div className="lp2-nav-cta">
        <Link to="/login" style={{ textDecoration: "none" }}>
          <GlassButton size="sm" variant="secondary">Sign in</GlassButton>
        </Link>
      </div>
    </nav>
  );
}
export default Nav;
