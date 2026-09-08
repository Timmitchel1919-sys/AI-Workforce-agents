import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { X } from "./icons";
import { IconButton } from "./Button";
import { cn } from "../../lib/utils";

/* =================================================================== */
/* Dialog & Drawer — native <dialog> (focus trap, Esc, inert bg free)   */
/* =================================================================== */
interface BaseOverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Hide the default close button (e.g. a forced choice). */
  hideClose?: boolean;
}

function useDialogElement(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      // jsdom (tests) may not implement showModal — fall back to the attribute.
      try {
        el.showModal();
      } catch {
        el.setAttribute("open", "");
      }
    }
    if (!open && el.open) {
      try {
        el.close();
      } catch {
        el.removeAttribute("open");
      }
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClose = () => onClose();
    el.addEventListener("close", handleClose);
    return () => el.removeEventListener("close", handleClose);
  }, [onClose]);

  const onBackdropClick = useCallback(
    (event: ReactMouseEvent<HTMLDialogElement>) => {
      if (event.target === ref.current) onClose();
    },
    [onClose],
  );

  return { ref, onBackdropClick };
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  hideClose,
  size = "md",
}: BaseOverlayProps & { size?: "md" | "lg" }) {
  const { ref, onBackdropClick } = useDialogElement(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className={cn("ui-dialog", size === "lg" && "ui-dialog--lg")}
      aria-labelledby={titleId}
      onClick={onBackdropClick}
      onCancel={onClose}
    >
      <div className="ui-overlay__header">
        <h2 id={titleId} className="ui-overlay__title">
          {title}
        </h2>
        {hideClose ? null : (
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
        )}
      </div>
      <div className="ui-overlay__body">{children}</div>
      {footer ? <div className="ui-overlay__footer">{footer}</div> : null}
    </dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  hideClose,
}: BaseOverlayProps) {
  const { ref, onBackdropClick } = useDialogElement(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className="ui-drawer"
      aria-labelledby={titleId}
      onClick={onBackdropClick}
      onCancel={onClose}
    >
      <div className="ui-overlay__header">
        <h2 id={titleId} className="ui-overlay__title">
          {title}
        </h2>
        {hideClose ? null : (
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
        )}
      </div>
      <div className="ui-overlay__body">{children}</div>
      {footer ? <div className="ui-overlay__footer">{footer}</div> : null}
    </dialog>
  );
}

/* =================================================================== */
/* Anchored floating surfaces — Popover / Dropdown / Tooltip            */
/* =================================================================== */
function useDismiss(
  open: boolean,
  close: () => void,
  containerRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close, containerRef]);
}

export function Popover({
  trigger,
  children,
  label = "More",
}: {
  trigger: (props: {
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "dialog";
  }) => ReactNode;
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);

  return (
    <div
      className="ui-anchor"
      ref={ref}
      style={{ position: "relative", display: "inline-flex" }}
    >
      {trigger({
        onClick: () => setOpen((v) => !v),
        "aria-expanded": open,
        "aria-haspopup": "dialog",
      })}
      {open ? (
        <div className="ui-popover" role="dialog" aria-label={label}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface DropdownItem {
  id: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Dropdown({
  trigger,
  items,
  label = "Actions",
}: {
  trigger: (props: {
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
  }) => ReactNode;
  items: ReadonlyArray<DropdownItem | "separator">;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);

  return (
    <div
      className="ui-anchor"
      ref={ref}
      style={{ position: "relative", display: "inline-flex" }}
    >
      {trigger({
        onClick: () => setOpen((v) => !v),
        "aria-expanded": open,
        "aria-haspopup": "menu",
      })}
      {open ? (
        <div className="ui-dropdown" role="menu" aria-label={label}>
          {items.map((item, index) =>
            item === "separator" ? (
              <div
                key={`sep-${index}`}
                className="ui-dropdown__sep"
                role="none"
              />
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={cn(
                  "ui-dropdown__item",
                  item.danger && "ui-dropdown__item--danger",
                )}
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect();
                  close();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Tooltip({
  content,
  children,
}: {
  content: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="ui-tooltip__trigger"
      style={{ position: "relative" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          id={id}
          className="ui-tooltip"
          style={{ bottom: "calc(100% + 6px)", left: 0 }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
