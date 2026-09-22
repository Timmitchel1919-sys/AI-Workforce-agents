import type { ReactNode } from "react";
import "./PageContainer.css";

export type PageContainerVariant = "default" | "wide" | "full";

interface PageContainerProps {
  children: ReactNode;
  variant?: PageContainerVariant;
  className?: string;
}

export default function PageContainer({
  children,
  variant = "default",
  className,
}: PageContainerProps) {
  return (
    <div className={[
      "page-container",
      variant !== "default" ? `page-container--${variant}` : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ")}>
      {children}
    </div>
  );
}
