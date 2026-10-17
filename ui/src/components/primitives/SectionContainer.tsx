import * as React from "react";
import "./primitives.css";

export interface SectionContainerProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  lede?: React.ReactNode;
  as?: "section" | "div" | "article";
}

export function SectionContainer({
  eyebrow,
  title,
  lede,
  children,
  as: Tag = "section",
  className,
  ...rest
}: SectionContainerProps) {
  return (
    <Tag className={["aw-section", className].filter(Boolean).join(" ")} {...rest}>
      <div className="aw-section-inner">
        {eyebrow && <div className="aw-section-eyebrow">{eyebrow}</div>}
        {title && <h2 className="aw-section-title">{title}</h2>}
        {lede && <p className="aw-section-lede">{lede}</p>}
        {children}
      </div>
    </Tag>
  );
}
export default SectionContainer;
