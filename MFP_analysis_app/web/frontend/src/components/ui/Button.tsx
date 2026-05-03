import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";
import clsx from "clsx";
import { Tooltip } from "../Tooltip";
import { Spinner } from "../Spinner";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger" | "subtle";
  size?: "sm" | "md";
  loading?: boolean;
  loadingText?: string;
  /** Shown as a tooltip when the button is disabled */
  disabledReason?: string;
  /** Shown as a tooltip when the button is enabled */
  tooltip?: string;
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "btn-primary",
  ghost:   "btn-ghost",
  danger:  "btn-danger",
  subtle:  "btn text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200",
};

const SIZE_CLS: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-2 py-1 text-[12px]",
  md: "",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "ghost",
      size = "md",
      loading = false,
      loadingText,
      disabledReason,
      tooltip,
      icon,
      children,
      disabled,
      className,
      ...rest
    },
    ref,
  ) {
    const isDisabled = disabled || loading;
    const tipContent = isDisabled ? disabledReason : tooltip;

    const btn = (
      <button
        ref={ref}
        disabled={isDisabled}
        className={clsx(VARIANT_CLS[variant], SIZE_CLS[size], className)}
        aria-disabled={isDisabled || undefined}
        {...rest}
      >
        {loading ? (
          <>
            <Spinner size="sm" />
            {loadingText ?? children}
          </>
        ) : (
          <>
            {icon}
            {children}
          </>
        )}
      </button>
    );

    if (!tipContent) return btn;

    return (
      <Tooltip content={tipContent} placement="top">
        {/* span relay: disabled buttons don't receive mouse events */}
        <span
          className={clsx("inline-flex", isDisabled && "cursor-not-allowed")}
          aria-hidden={!isDisabled}
        >
          {btn}
        </span>
      </Tooltip>
    );
  },
);
