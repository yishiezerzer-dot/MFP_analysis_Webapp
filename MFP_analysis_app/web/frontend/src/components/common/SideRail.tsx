import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { PanelLeftOpen } from "lucide-react";
import { COMPACT_LAYOUT_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";
import { ICON_PROPS } from "./ChartCardParts";

// Side list (e.g. sessions) that is a normal column on desktops and, below the compact breakpoint,
// a slim rail that opens over the content on hover or click (Escape / outside click closes it).
export function SideRail({
  label,
  rail,
  children,
  widthClass = "w-64",
}: {
  label: string;
  rail: ReactNode;
  children: (close: () => void) => ReactNode;
  widthClass?: string;
}) {
  const compact = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const expanded = !compact || hovered || open;
  const close = () => setOpen(false);

  return (
    <div className={clsx("relative shrink-0", compact ? "w-12" : widthClass)}>
      <aside
        ref={asideRef}
        aria-label={label}
        aria-expanded={expanded}
        onMouseEnter={() => compact && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={clsx(
          "absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden border-r border-ink-200 bg-canvas text-ink-900",
          "transition-[width] duration-200 ease-out",
          expanded ? widthClass : "w-12",
          compact && expanded && "shadow-lg",
        )}
      >
        {expanded ? (
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
            <div className="text-section px-2 pb-1">{label}</div>
            {children(close)}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 py-2">
            <button
              type="button"
              className="btn-ghost px-1.5"
              aria-label={`Open ${label.toLowerCase()}`}
              title={`Open ${label.toLowerCase()}`}
              onClick={() => setOpen(true)}
            >
              <PanelLeftOpen {...ICON_PROPS} />
            </button>
            {rail}
          </div>
        )}
      </aside>
    </div>
  );
}
