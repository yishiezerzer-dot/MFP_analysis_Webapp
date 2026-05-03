import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";
import clsx from "clsx";
import { Tooltip } from "../Tooltip";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for accessibility */
  "aria-label": string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "danger" | "subtle";
  /** Tooltip — defaults to aria-label if not provided */
  tooltip?: string;
  /** Shown as tooltip when disabled */
  disabledReason?: string;
  icon: ReactNode;
}

const SIZE_CLS = {
  sm: "h-6 w-6 rounded-[4px]",
  md: "h-7 w-7 rounded-[5px]",
  lg: "h-8 w-8 rounded-[6px]",
};

const VARIANT_CLS = {
  ghost:  "text-ink-500 hover:bg-ink-100 hover:text-ink-700 active:bg-ink-200",
  danger: "text-danger hover:bg-danger-surface active:bg-danger/20",
  subtle: "text-ink-400 hover:bg-ink-50 hover:text-ink-600",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      "aria-label": ariaLabel,
      size = "md",
      variant = "ghost",
      tooltip,
      disabledReason,
      icon,
      disabled,
      className,
      ...rest
    },
    ref,
  ) {
    const tipContent = disabled ? disabledReason : (tooltip ?? ariaLabel);

    const btn = (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        className={clsx(
          "inline-flex items-center justify-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
          "disabled:cursor-not-allowed disabled:opacity-40",
          SIZE_CLS[size],
          VARIANT_CLS[variant],
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    );

    return (
      <Tooltip content={tipContent} placement="top">
        <span
          className={clsx("inline-flex", disabled && "cursor-not-allowed")}
          aria-hidden={!disabled}
        >
          {btn}
        </span>
      </Tooltip>
    );
  },
);
