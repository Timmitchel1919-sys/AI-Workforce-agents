import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallSnapshot {
  canPrompt: boolean;
  isIos: boolean;
  isInstalled: boolean;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let snapshot: InstallSnapshot = readSnapshot();
const listeners = new Set<() => void>();

function readSnapshot(): InstallSnapshot {
  if (typeof window === "undefined") {
    return { canPrompt: false, isIos: false, isInstalled: false };
  }

  const navigatorLike = window.navigator as Navigator & {
    standalone?: boolean;
  };
  const isIos = /iphone|ipad|ipod/i.test(navigatorLike.userAgent);
  const isInstalled =
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorLike.standalone === true;

  return { canPrompt: deferredPrompt !== null, isIos, isInstalled };
}

function publish(): void {
  snapshot = readSnapshot();
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    publish();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    publish();
  });
}

export function usePwaInstall() {
  const [state, setState] = useState<InstallSnapshot>(snapshot);

  useEffect(() => {
    const listener = () => setState(snapshot);
    listeners.add(listener);
    publish();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  async function install(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!deferredPrompt) return "unavailable";
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    publish();
    return outcome;
  }

  return {
    ...state,
    canInstall: state.canPrompt || state.isIos,
    install,
  };
}
