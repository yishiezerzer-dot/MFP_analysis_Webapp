import { useEffect, useState } from "react";
import { Lightbulb, Sparkles, X } from "lucide-react";
import { api, type ExampleSummary } from "../api";
import { ICON_PROPS } from "./common/ChartCardParts";
import { Hint } from "./Hint";
import { useToast } from "./Toast";

// Display names of example sessions start with this (set by the backend).
export const EXAMPLE_PREFIX = "Example – ";

let examplesPromise: Promise<ExampleSummary[]> | null = null;

function loadExamples(): Promise<ExampleSummary[]> {
  examplesPromise ??= api.examples.list().catch((err) => {
    examplesPromise = null;
    throw err;
  });
  return examplesPromise;
}

export function useExample(module: ExampleSummary["module"]): ExampleSummary | null {
  const [example, setExample] = useState<ExampleSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadExamples()
      .then((list) => !cancelled && setExample(list.find((e) => e.module === module) ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [module]);
  return example;
}

export function isExampleName(name: string | null | undefined): boolean {
  return Boolean(name?.startsWith(EXAMPLE_PREFIX));
}

const dismissKey = (id: string) => `mfp.exampleTips.dismissed.${id}`;

// Opens this tab's example as ordinary sessions and hands their ids to the view.
export function TryExampleButton({
  module,
  onOpened,
  className,
}: {
  module: ExampleSummary["module"];
  onOpened: (sessionIds: string[]) => void | Promise<void>;
  className?: string;
}) {
  const example = useExample(module);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!example) return null;
  const open = async () => {
    setBusy(true);
    try {
      const opened = await api.examples.open(example.id);
      try {
        window.localStorage.removeItem(dismissKey(example.id));
      } catch {
        // storage unavailable: tips just show again
      }
      await onOpened(opened.session_ids);
    } catch (err) {
      toast(`Could not open the example: ${String(err)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Hint id="app.tryExample" extra={example.title}>
      <button type="button" className={className ?? "btn-ghost border border-ink-200"} disabled={busy} onClick={() => void open()}>
        <Sparkles {...ICON_PROPS} />
        {busy ? "Opening example…" : "Try with example data"}
      </button>
    </Hint>
  );
}

// "Try this" steps shown while an example file is the active one; dismissible.
export function ExampleTips({ module, activeName }: { module: ExampleSummary["module"]; activeName: string | null | undefined }) {
  const example = useExample(module);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!example) return;
    try {
      setDismissed(window.localStorage.getItem(dismissKey(example.id)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [example, activeName]);
  if (!example || dismissed || !isExampleName(activeName)) return null;
  return (
    <div className="flex shrink-0 items-start gap-3 rounded-lg border border-brand-500/30 bg-brand-50 px-4 py-3 text-[13px] text-ink-800">
      <Lightbulb {...ICON_PROPS} className="mt-0.5 shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink-900">{example.title}</div>
        <p className="mt-0.5 text-ink-600">{example.description}</p>
        <div className="mt-2 font-medium text-ink-800">Try this</div>
        <ol className="mt-1 list-decimal pl-5 text-ink-700">
          {example.try_this.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      <button
        type="button"
        className="btn-ghost px-1.5"
        aria-label="Hide example tips"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(dismissKey(example.id), "1");
          } catch {
            // storage unavailable: hidden until the page reloads
          }
        }}
      >
        <X {...ICON_PROPS} />
      </button>
    </div>
  );
}
