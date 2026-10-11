import { createContext, useContext } from "react";

export interface Report {
  tone: "success" | "warning" | "danger";
  title?: string;
  message: string;
  /** Extra lines, e.g. per-step rollback results; each is shown with its own tone. */
  lines?: { key: string; tone: "success" | "warning" | "danger"; text: string }[];
}

interface ReportApi { report: (report: Report) => void; clear: () => void }
const ReportContext = createContext<ReportApi>({ report: () => undefined, clear: () => undefined });
export const ReportProvider = ReportContext.Provider;
export const useReport = (): ReportApi => useContext(ReportContext);
