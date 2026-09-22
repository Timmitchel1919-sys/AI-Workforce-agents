import React from "react";
import "./ui.css";

export interface BreadcrumbItem { label: React.ReactNode; href?: string; current?: boolean }

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol style={{ display:'flex', gap:8, listStyle:'none', padding:0, margin:0 }}>
        {items.map((it, idx) => (
          <li key={idx} aria-current={it.current ? 'page' : undefined}>
            {it.href && !it.current ? <a href={it.href}>{it.label}</a> : <span>{it.label}</span>}
            {idx < items.length - 1 ? <span aria-hidden style={{ margin:'0 8px' }}>/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default Breadcrumb;
