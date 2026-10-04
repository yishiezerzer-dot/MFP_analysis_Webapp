import type { ReactNode } from "react";
import type { ExampleSummary } from "../../api";
import { TryExampleButton } from "../ExampleData";

// First thing a new user sees on a tab: what it is for, which files it takes, and two ways in.
export function TabEmptyState({
  icon,
  title,
  purpose,
  accepts,
  pickLabel,
  onPick,
  exampleModule,
  onExampleOpened,
  extra,
}: {
  icon: ReactNode;
  title: string;
  purpose: ReactNode;
  accepts: ReactNode;
  pickLabel: string;
  onPick: () => void;
  exampleModule: ExampleSummary["module"];
  onExampleOpened: (sessionIds: string[]) => void | Promise<void>;
  extra?: ReactNode;
}) {
  return (
    <div className="card flex shrink-0 flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-ink-500">{icon}</div>
      <div className="text-card-title">{title}</div>
      <p className="max-w-lg text-sm text-ink-600">{purpose}</p>
      <p className="max-w-lg text-[12px] text-ink-500">{accepts}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="btn-primary" onClick={onPick}>
          {pickLabel}
        </button>
        <TryExampleButton module={exampleModule} onOpened={onExampleOpened} />
        {extra}
      </div>
      <p className="text-caption">You can also drop files anywhere on the page.</p>
    </div>
  );
}
