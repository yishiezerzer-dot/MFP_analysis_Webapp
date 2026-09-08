import { type ReactNode } from "react";
import clsx from "clsx";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "xs" | "sm" | "md";
  className?: string;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  className,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={clsx(
        "inline-flex items-center rounded-lg border border-ink-200 bg-ink-100/70 p-0.5 text-xs text-ink-600 shadow-inner",
        className,
      )}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => {
              if (!opt.disabled && opt.value !== value) {
                onChange(opt.value);
              }
            }}
            className={clsx(
              "flex items-center justify-center gap-1.5 rounded-md font-medium transition-all select-none",
              size === "xs" && "px-2 py-0.5 text-[11px]",
              size === "sm" && "px-2.5 py-1 text-xs",
              size === "md" && "px-3 py-1.5 text-sm",
              isSelected
                ? "bg-surface text-ink-900 shadow-sm ring-1 ring-ink-900/5 font-semibold"
                : "text-ink-600 hover:text-ink-900 hover:bg-surface/50",
              opt.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-ink-600",
            )}
          >
            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
