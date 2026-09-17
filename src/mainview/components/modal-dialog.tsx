import {
  useEffect,
  useId,
  useRef,
  type PropsWithChildren,
  type ReactNode,
} from "react";

type ModalDialogProps = PropsWithChildren<{
  readonly title: string;
  readonly description?: ReactNode;
  readonly size?: "default" | "wide";
  readonly onClose: () => void;
}>;

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function ModalDialog({
  title,
  description,
  size = "default",
  onClose,
  children,
}: ModalDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    const initialTarget =
      dialog.querySelector<HTMLElement>("[data-modal-autofocus]") ??
      focusable()[0] ??
      dialog;
    initialTarget.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const targets = focusable();
      if (targets.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = targets[0]!;
      const last = targets.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = bodyOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal-card ${size === "wide" ? "modal-card-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id={titleId} className="text-xl font-semibold">
              {title}
            </h3>
            {description ? (
              <div id={descriptionId} className="mt-2 text-sm text-zinc-500">
                {description}
              </div>
            ) : null}
          </div>
          <button
            className="table-action"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
