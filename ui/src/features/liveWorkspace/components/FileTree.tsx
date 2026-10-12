import { useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, File as FileIcon, Folder } from "lucide-react";
import { useTree } from "../hooks/useRuntime";
import { badgeKeyFor, baseName, sortEntries } from "../lib/logic";
import { useT } from "../lib/useT";
import type { FileChange } from "../types";
import { ErrorPanel, Skeleton, Tag } from "./common";

interface TreeCtx {
  executionId: string;
  changes: Map<string, FileChange>;
  selectedPath: string | undefined;
  focusPath: string | undefined;
  expanded: Set<string>;
  toggle: (path: string) => void;
  open: (path: string) => void;
  setFocusPath: (path: string) => void;
}

function Branch({ dir, level, ctx }: { dir: string; level: number; ctx: TreeCtx }) {
  const { tt } = useT();
  const { tree, isLoading, error, refetch } = useTree(ctx.executionId, dir, true);
  if (isLoading) return <li role="none"><Skeleton label={tt("tree.loading")} /></li>;
  if (error) return <li role="none"><ErrorPanel error={error} onRetry={() => void refetch()} /></li>;
  const entries = sortEntries(tree?.entries ?? []);
  if (entries.length === 0) return <li role="none" className="lw-muted">{tt("tree.emptyDir")}</li>;
  return (
    <>
      {entries.map((entry) => {
        const isDir = entry.type === "dir";
        const open = isDir && ctx.expanded.has(entry.path);
        const change = isDir ? undefined : ctx.changes.get(entry.path);
        return (
          <li
            key={entry.path}
            role="treeitem"
            aria-level={level}
            aria-expanded={isDir ? open : undefined}
            aria-selected={!isDir ? ctx.selectedPath === entry.path : undefined}
            tabIndex={ctx.focusPath === entry.path ? 0 : -1}
            data-path={entry.path}
            data-type={entry.type}
            className="lw-tree__item"
            onFocus={(e) => { if (e.target === e.currentTarget) ctx.setFocusPath(entry.path); }}
          >
            <div
              className={`lw-tree__label${ctx.selectedPath === entry.path ? " is-selected" : ""}`}
              onClick={() => (isDir ? ctx.toggle(entry.path) : ctx.open(entry.path))}
            >
              {isDir ? (open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />) : <span className="lw-tree__spacer" aria-hidden />}
              {isDir ? <Folder size={14} aria-hidden /> : <FileIcon size={14} aria-hidden />}
              <span className="lw-tree__name">{baseName(entry.path)}</span>
              {change ? <Tag tone={change.operation === "delete" ? "danger" : "info"}>{tt(`tree.badge.${badgeKeyFor(change.operation)}`)}</Tag> : null}
            </div>
            {open ? (
              <ul role="group" className="lw-tree__group">
                <Branch dir={entry.path} level={level + 1} ctx={ctx} />
              </ul>
            ) : null}
          </li>
        );
      })}
      {tree?.truncated ? <li role="none" className="lw-muted">{tt("tree.truncated")}</li> : null}
    </>
  );
}

/** Lazy-loading, keyboard-accessible read-only project tree. */
export function FileTree({ executionId, changes, selectedPath, onOpen }: {
  executionId: string;
  changes: Map<string, FileChange>;
  selectedPath: string | undefined;
  onOpen: (path: string) => void;
}) {
  const { tt } = useT();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusPath, setFocusPath] = useState<string | undefined>(undefined);
  const listRef = useRef<HTMLUListElement>(null);

  const items = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
  const focusItem = (el: HTMLElement | undefined) => { if (el) { setFocusPath(el.dataset.path); el.focus(); } };

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute("role") !== "treeitem") return;
    const all = items();
    const index = all.indexOf(target);
    const path = target.dataset.path ?? "";
    const isDir = target.dataset.type === "dir";
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); focusItem(all[index + 1]); break;
      case "ArrowUp": event.preventDefault(); focusItem(all[index - 1]); break;
      case "Home": event.preventDefault(); focusItem(all[0]); break;
      case "End": event.preventDefault(); focusItem(all[all.length - 1]); break;
      case "ArrowRight":
        event.preventDefault();
        if (isDir) {
          if (!expanded.has(path)) toggle(path);
          else focusItem(all[index + 1]);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (isDir && expanded.has(path)) toggle(path);
        else focusItem(target.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (isDir) toggle(path); else onOpen(path);
        break;
      default:
    }
  };

  const ctx: TreeCtx = {
    executionId, changes, selectedPath, focusPath, expanded, toggle, open: onOpen, setFocusPath,
  };

  return (
    <section className="lw-panel lw-area-tree" aria-labelledby="lw-tree-heading">
      <h2 id="lw-tree-heading" className="lw-panel__title">{tt("tree.title")}</h2>
      <p className="lw-muted">{tt("tree.hint")}</p>
      <ul ref={listRef} role="tree" aria-label={tt("tree.label")} className="lw-tree" onKeyDown={onKeyDown}>
        <RootFocus ctx={ctx} />
      </ul>
    </section>
  );
}

/** The root level; also makes the first entry the roving tab stop. */
function RootFocus({ ctx }: { ctx: TreeCtx }) {
  const { tree } = useTree(ctx.executionId, "", true);
  const first = sortEntries(tree?.entries ?? [])[0]?.path;
  const effective: TreeCtx = { ...ctx, focusPath: ctx.focusPath ?? first };
  return <Branch dir="" level={1} ctx={effective} />;
}
