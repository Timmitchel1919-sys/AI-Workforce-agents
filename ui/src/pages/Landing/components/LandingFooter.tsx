import { LOGO_MARK_SRC, scrollToSection } from "../landingActions";

const footerLinks = [
  { id: "system", label: "System" },
  { id: "security", label: "Security" },
  { id: "architecture", label: "Architecture" },
];

export function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer__brand">
        <img src={LOGO_MARK_SRC} alt="" width={24} height={24} />
        <div>
          <p className="lp-footer__name">AI Workforce</p>
          <p className="lp-footer__tagline">AI-native software engineering infrastructure.</p>
        </div>
      </div>
      <nav aria-label="Footer">
        <ul className="lp-footer__links">
          {footerLinks.map((link) => (
            <li key={link.id}>
              <a href={`#${link.id}`} onClick={(e) => scrollToSection(e, link.id)}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}

export default LandingFooter;
