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
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        {subtitle !== undefined && (
          <p className="text-sm text-ink-500">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
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
