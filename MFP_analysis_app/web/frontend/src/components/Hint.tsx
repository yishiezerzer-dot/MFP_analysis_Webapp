import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import { getControl } from "../help/controls";
import { helpTopicTitle, useHelp } from "../help/HelpProvider";

// Hover/focus hint for a control, from the control registry. Also marks the control for the
// Ctrl+K finder and tours (data-control).
export function Hint({
  id,
  children,
  className,
  placement,
  extra,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  placement?: "top" | "bottom" | "left" | "right";
  // A live status line shown first, e.g. the current experiment tag.
  extra?: ReactNode;
}) {
  const { setActiveHint } = useHelp();
  const control = getControl(id);
  const topic = control ? helpTopicTitle(control) : null;
  const content = control ? (
    <span className="flex flex-col gap-0.5">
      {extra && <span className="font-medium">{extra}</span>}
      <span>
        <strong className="font-semibold">{control.label}</strong> — {control.what}
      </span>
      {control.typical && <span className="text-white/80">Typical: {control.typical}</span>}
      {topic && <span className="text-white/65">Help: {topic} · F1</span>}
    </span>
  ) : undefined;
  return (
    <Tooltip
      content={content}
      dataControl={id}
      tipClassName="max-w-[300px]"
      className={className}
      placement={placement}
      onActiveChange={(active) => setActiveHint(id, active)}
    >
      {children}
    </Tooltip>
  );
}
