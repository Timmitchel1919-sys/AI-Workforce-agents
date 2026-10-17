import { Link } from "react-router-dom";
import "./sections.css";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="lp2-footer">
      <span>© {year} AI Workforce · Private operating system</span>
      <span style={{ display: "inline-flex", gap: "1rem" }}>
        <Link to="/login">Sign in</Link>
        <a href="#security">Security</a>
      </span>
    </footer>
  );
}
export default Footer;
