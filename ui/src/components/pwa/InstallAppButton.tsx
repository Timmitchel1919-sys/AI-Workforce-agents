import { Download } from "lucide-react";
import { Button } from "../ui";
import { usePwaInstall } from "../../pwa/install";

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
    <Button
      className={className}
      variant="outline"
      fullWidth={fullWidth}
      onClick={() => void handleInstall()}
    >
      <Download size={16} aria-hidden="true" />
      Download app
    </Button>
  );
}
