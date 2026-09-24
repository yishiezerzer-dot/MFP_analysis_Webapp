import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

export const ICON_PROPS = { size: 15, strokeWidth: 1.8, "aria-hidden": true } as const;

// Quiet card-toolbar action: line icon + label, no border. `active` marks a toggled-on state.
export function ToolbarButton({
  icon: Icon,
  label,
  title,
  onClick,
  active,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "btn-ghost whitespace-nowrap px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-brand-50 text-brand-800 hover:bg-brand-100",
      )}
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon {...ICON_PROPS} />
      <span>{label}</span>
    </button>
  );
}

// Card title plus one grey status line ("ESI+ · 1,554 points · RT 4.69 min") instead of chips.
export function ChartCardTitle({ title, status }: { title: string; status: Array<string | false | null | undefined> }) {
  const line = status.filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h3 className="text-card-title whitespace-nowrap">{title}</h3>
      {line && <span className="text-caption min-w-0 truncate">{line}</span>}
    </div>
  );
}
