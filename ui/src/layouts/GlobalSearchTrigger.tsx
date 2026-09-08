import { useToast } from "../components/ui";
import { Search } from "../components/ui";

/**
 * Boundary for a future command/search palette. UI-3 ships only the trigger —
 * no search engine, no backend endpoints. Clicking it acknowledges the boundary
 * so the control isn't dead space.
 */
export function GlobalSearchTrigger() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      className="global-search"
      aria-label="Search (coming soon)"
      onClick={() =>
        toast({
          tone: "info",
          title: "Search is coming soon",
          detail: "Global search across agents, tasks, and workflows.",
        })
      }
    >
      <Search width={15} height={15} aria-hidden="true" />
      <span className="global-search__text">Search…</span>
      <kbd className="global-search__kbd">⌘K</kbd>
    </button>
  );
}
