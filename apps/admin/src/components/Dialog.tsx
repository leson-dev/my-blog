import { type ReactNode, useEffect, useId } from "react";

/** A dialog over a dimmed page. Escape calls `onClose` when given. */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay">
      <dialog open aria-labelledby={titleId} className="dialog">
        <h2 id={titleId}>{title}</h2>
        {children}
      </dialog>
    </div>
  );
}
