import clsx from "clsx";
import { ReactNode } from "react";

interface AlertBannerProps {
  kind: "error" | "warning" | "info" | "success";
  message: string;
  /** Optional secondary detail line */
  detail?: string;
  /** If provided, renders a dismiss (×) button */
  onDismiss?: () => void;
  /** If provided, renders a "Retry" button */
  onRetry?: () => void;
  /** Optional extra action */
  action?: { label: string; onClick: () => void };
  className?: string;
  children?: ReactNode;
}

const KIND_STYLES = {
  error: {
    wrapper: "bg-danger-surface border-danger/30 text-danger",
    icon: "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
    label: "Error",
    live: "assertive" as const,
  },
  warning: {
    wrapper: "bg-warning-surface border-warning/30 text-warning",
    icon: "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
    label: "Warning",
    live: "polite" as const,
  },
  info: {
    wrapper: "bg-info-surface border-info/30 text-info",
    icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    label: "Info",
    live: "polite" as const,
  },
  success: {
    wrapper: "bg-success-surface border-success/30 text-success",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    label: "Success",
    live: "polite" as const,
  },
};

export function AlertBanner({
  kind,
  message,
  detail,
  onDismiss,
  onRetry,
  action,
  className,
  children,
}: AlertBannerProps) {
  const s = KIND_STYLES[kind];

  return (
    <div
      role="alert"
      aria-live={s.live}
      aria-atomic="true"
      className={clsx(
        "flex items-start gap-2.5 rounded-[8px] border px-3 py-2.5 text-[13px]",
        s.wrapper,
        className,
      )}
    >
      {/* icon */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-[1px] h-[15px] w-[15px] shrink-0 opacity-90"
      >
        <path d={s.icon} />
      </svg>

      {/* content */}
      <div className="min-w-0 flex-1">
        <span className="font-medium">{message}</span>
        {detail && (
          <p className="mt-0.5 text-[11px] opacity-80 break-words">{detail}</p>
        )}
        {children}
        {(onRetry || action) && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-[12px] font-semibold underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current rounded"
              >
                Retry
              </button>
            )}
            {action && (
              <button
                type="button"
                onClick={action.onClick}
                className="text-[12px] font-semibold underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current rounded"
              >
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>

      {/* dismiss */}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current transition-opacity"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M4.22 4.22a.75.75 0 011.06 0L8 6.94l2.72-2.72a.75.75 0 111.06 1.06L9.06 8l2.72 2.72a.75.75 0 11-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 01-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 010-1.06z"/>
          </svg>
        </button>
      )}
    </div>
  );
}
