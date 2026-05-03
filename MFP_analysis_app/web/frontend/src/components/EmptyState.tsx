import { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, hint, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-4 py-20 text-center ${className}`}>
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink-100/80 text-ink-400 border border-ink-200/60">
          {icon}
        </div>
      )}
      <div>
        <p className="text-[13px] font-medium text-ink-700">{title}</p>
        {hint && <p className="mt-1 text-[12px] text-ink-500 max-w-[240px] leading-snug">{hint}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
