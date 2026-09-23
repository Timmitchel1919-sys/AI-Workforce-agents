import { Download } from "lucide-react";
import { usePwaInstall } from "../../pwa/install";
import "./InstallAppButton.css";

export function InstallAppButton({
  className,
  fullWidth = false,
}: {
  className?: string;
  fullWidth?: boolean;
}) {
  const { canInstall, isInstalled, isIos, install } = usePwaInstall();

  if (isInstalled || !canInstall) return null;

  async function handleInstall() {
    if (isIos) {
      window.alert(
        "To install AI Workforce, use Share and then Add to Home Screen.",
      );
      return;
    }
    await install();
  }

  return (
    <button
      type="button"
      className={`pwa-install-button${fullWidth ? " pwa-install-button--full" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => void handleInstall()}
    >
      <Download size={16} aria-hidden="true" />
      Download app
    </button>
  );
}
