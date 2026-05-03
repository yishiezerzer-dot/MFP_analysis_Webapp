import { ReactNode } from "react";
import clsx from "clsx";
import { Spinner } from "./Spinner";
import { EmptyState } from "./EmptyState";

interface ChartPanelProps {
  title?: string;
  /** Action buttons rendered in the header (export, settings…) */
  actions?: ReactNode;
  loading?: boolean;
  loadingText?: string;
  /** When true, renders an empty state instead of children */
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
  /** Icon character or SVG path for empty state */
  emptyIcon?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function ChartPanel({
  title,
  actions,
  loading,
  loadingText,
  empty,
  emptyTitle = "No data",
  emptyHint,
  emptyAction,
  emptyIcon,
  children,
  className,
  bodyClassName,
}: ChartPanelProps) {
  return (
    <div className={clsx("card flex flex-col overflow-hidden", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-ink-200/50 px-3 py-2">
          {title && (
            <span className="text-[12px] font-semibold text-ink-700">{title}</span>
          )}
          {actions && (
            <div className="flex items-center gap-1">{actions}</div>
          )}
        </div>
      )}

      <div className={clsx("relative flex min-h-0 flex-1 flex-col", bodyClassName)}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/70 backdrop-blur-[1px]">
            <Spinner size="md" label={loadingText ?? "Loading…"} />
          </div>
        )}

        {!loading && empty ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState
              icon={emptyIcon ?? "📊"}
              title={emptyTitle}
              hint={emptyHint}
              action={emptyAction}
            />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
