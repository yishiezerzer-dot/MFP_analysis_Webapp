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
    <div className={`flex flex-col items-center justify-center gap-3 py-16 text-center ${className}`}>
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-ink-400">
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm font-medium text-ink-600">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
