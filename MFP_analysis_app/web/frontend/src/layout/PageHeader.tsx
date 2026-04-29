import { ReactNode, useEffect } from "react";
import { useOutletContext } from "react-router-dom";

export interface PageHeaderContextValue {
  setHeader: (node: ReactNode) => void;
}

/** Standard page-header layout used by every view. */
export function PageHeaderContent({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-12 flex-wrap items-center justify-between gap-3 px-4">
      <div className="min-w-0 flex items-baseline gap-2.5">
        <h1 className="truncate text-[14px] font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle !== undefined && (
          <span className="text-[12px] text-ink-500 truncate">{subtitle}</span>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      )}
    </div>
  );
}

/**
 * Push `node` into the global page header slot rendered by `Layout` in
 * `App.tsx`. Updates every render so state-driven header content (e.g. a
 * "Working…" spinner in a button) stays live, and clears on unmount so the
 * header doesn't leak content from the previous route.
 */
export function usePageHeader(node: ReactNode): void {
  const { setHeader } = useOutletContext<PageHeaderContextValue>();

  useEffect(() => {
    setHeader(node);
  });

  useEffect(() => {
    return () => setHeader(null);
  }, [setHeader]);
}
