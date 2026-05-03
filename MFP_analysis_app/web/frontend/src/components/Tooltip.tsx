import {
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  /** Tooltip content — string or node. Alias: `text`. */
  content?: ReactNode;
  /** Alias for content (backward compat). */
  text?: string;
  children: ReactNode;
  /** Where to prefer opening the tooltip relative to the trigger. */
  placement?: "top" | "bottom" | "left" | "right";
  /** Alias for placement (backward compat). */
  side?: "top" | "bottom" | "left" | "right";
  /** Show delay in ms (default 400). */
  delay?: number;
  className?: string;
}

export function Tooltip({
  content,
  text,
  children,
  placement,
  side,
  delay = 400,
  className,
}: TooltipProps) {
  const tip = content ?? text;
  const pos = placement ?? side ?? "top";
  const id = useId();

  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }, []);

  const show = useCallback(() => {
    if (!tip) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(true), delay);
  }, [tip, delay]);

  // Position the tooltip after it renders
  useEffect(() => {
    if (!visible || !wrapRef.current || !tipRef.current) return;
    const anchor = wrapRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const GAP = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;

    if (pos === "top") {
      top = anchor.top - tip.height - GAP;
      left = anchor.left + anchor.width / 2 - tip.width / 2;
    } else if (pos === "bottom") {
      top = anchor.bottom + GAP;
      left = anchor.left + anchor.width / 2 - tip.width / 2;
    } else if (pos === "left") {
      top = anchor.top + anchor.height / 2 - tip.height / 2;
      left = anchor.left - tip.width - GAP;
    } else {
      top = anchor.top + anchor.height / 2 - tip.height / 2;
      left = anchor.right + GAP;
    }

    // Clamp to viewport
    left = Math.max(8, Math.min(left, vw - tip.width - 8));
    top  = Math.max(8, Math.min(top,  vh - tip.height - 8));

    setCoords({ top, left });
  }, [visible, pos]);

  // Dismiss on Escape
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, hide]);

  if (!tip) return <>{children}</>;

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className ?? ""}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={hide}
      aria-describedby={visible ? id : undefined}
    >
      {children}
      {visible &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            style={{
              position: "fixed",
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              zIndex: 9999,
              pointerEvents: "none",
            }}
            className="max-w-[220px] rounded-[5px] bg-ink-900 px-2.5 py-1.5 text-[12px] leading-snug text-white shadow-lg"
          >
            {tip}
          </div>,
          document.body,
        )}
    </span>
  );
}
