import type { ReactNode } from "react";

export function DocP({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-[13px] leading-relaxed text-ink-700">{children}</p>;
}

export function DocLead({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-sm font-medium text-ink-800">{children}</p>;
}

export function DocH4({ children }: { children: ReactNode }) {
  return (
    <h4 className="mb-2 mt-5 border-b border-ink-100 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-500 first:mt-0">
      {children}
    </h4>
  );
}

export function DocUl({ children }: { children: ReactNode }) {
  return <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[13px] text-ink-700">{children}</ul>;
}

export function DocOl({ children }: { children: ReactNode }) {
  return <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-[13px] text-ink-700">{children}</ol>;
}

export function DocLi({ children }: { children: ReactNode }) {
  return <li className="leading-relaxed">{children}</li>;
}

export function DocCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[12px] text-ink-800">{children}</code>
  );
}

export function DocNote({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-[12px] text-ink-600">
      {children}
    </div>
  );
}
