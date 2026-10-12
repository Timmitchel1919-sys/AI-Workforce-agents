import { createContext, useContext } from "react";

export interface Report {
  tone: "success" | "warning" | "danger";
  title?: string;
  message: string;
  checks?: { check: string; ok: boolean; detail: string }[];
}

interface ReportApi { report: (report: Report) => void; clear: () => void }
const ReportContext = createContext<ReportApi>({ report: () => undefined, clear: () => undefined });
export const ReportProvider = ReportContext.Provider;
export const useReport = (): ReportApi => useContext(ReportContext);
