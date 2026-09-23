import React from "react";
import "./ui.css";

interface TabItem { id: string; label: React.ReactNode; panel?: React.ReactNode }

export interface TabsProps {
  items: TabItem[];
  activeId?: string;
  onChange?: (id: string) => void;
}

export function Tabs({ items, activeId, onChange }: TabsProps) {
  const [activeInternal, setActiveInternal] = React.useState(
    activeId ?? items[0]?.id,
  );
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const active = activeId ?? activeInternal;

  const select = (id: string) => {
    if (activeId === undefined) {
      setActiveInternal(id);
    }
    onChange?.(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const currentIndex = items.findIndex(i => i.id === active);
    if (e.key === 'ArrowRight') {
      const next = items[(currentIndex + 1) % items.length];
      select(next.id);
    } else if (e.key === 'ArrowLeft') {
      const prev = items[(currentIndex - 1 + items.length) % items.length];
      select(prev.id);
    } else if (e.key === 'Home') {
      select(items[0].id);
    } else if (e.key === 'End') {
      select(items[items.length - 1].id);
    }
  };

  return (
    <div>
      <div ref={listRef} role="tablist" aria-label="Tabs" style={{ display: 'flex', gap: 8 }} onKeyDown={onKeyDown}>
        {items.map(item => (
          <button key={item.id} role="tab" aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1} onClick={() => select(item.id)}>{item.label}</button>
        ))}
      </div>
      <div>
        {items.map(item => (
          <div key={item.id} role="tabpanel" hidden={active !== item.id} aria-labelledby={item.id + '-tab'}>{item.panel}</div>
        ))}
      </div>
    </div>
  );
}

export default Tabs;
