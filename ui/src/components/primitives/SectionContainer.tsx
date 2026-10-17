import * as React from "react";
import "./primitives.css";

type HeadingLevel = "h2" | "h3" | "h4";

export interface SectionContainerProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  lede?: React.ReactNode;
  as?: "section" | "div" | "article";
  /** Heading tag for the section title (default h2). */
  headingAs?: HeadingLevel;
}

export function SectionContainer({
  eyebrow,
  title,
  lede,
  children,
  as: Tag = "section",
  headingAs: Heading = "h2",
  className,
  ...rest
}: SectionContainerProps) {
  return (
    <Tag className={["aw-section", className].filter(Boolean).join(" ")} {...rest}>
      <div className="aw-section-inner">
        {eyebrow && <div className="aw-section-eyebrow">{eyebrow}</div>}
        {title && <Heading className="aw-section-title">{title}</Heading>}
        {lede && <p className="aw-section-lede">{lede}</p>}
        {children}
      </div>
    </Tag>
  );
}
export default SectionContainer;
