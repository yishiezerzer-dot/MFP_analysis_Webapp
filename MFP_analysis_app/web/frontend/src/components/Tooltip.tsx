import { ReactNode, useRef, useState } from "react";

interface TooltipProps {
  text: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

export function Tooltip({ text, children, side = "top", delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timer.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  };

  const posClass: Record<string, string> = {
    top:    "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left:   "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right:  "left-full top-1/2 -translate-y-1/2 ml-1.5",
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded bg-ink-800 px-2 py-1 text-xs text-white shadow-lg ${posClass[side] ?? posClass.top}`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
