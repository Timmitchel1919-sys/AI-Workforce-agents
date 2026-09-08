import { useEffect } from "react";
import { APP_TITLE } from "../app/routes";

export function useDocumentTitle(segment: string | undefined): void {
  useEffect(() => {
    document.title = segment ? `${segment} · ${APP_TITLE}` : APP_TITLE;
  }, [segment]);
}
