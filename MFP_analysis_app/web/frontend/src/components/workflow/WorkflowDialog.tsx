import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HelpCircle, Wand2, X } from "lucide-react";
import { ICON_PROPS } from "../common/ChartCardParts";
import { useToast } from "../Toast";

// One question per screen. `render` draws the answer controls; `check` returns a problem
// (blocks Next) or null; `explain` is shown under "I don't know".
export interface WorkflowStep<A> {
  id: string;
  question: string;
  explain: string;
  render: (answers: A, set: (patch: Partial<A>) => void) => ReactNode;
  check?: (answers: A) => string | null;
  skip?: (answers: A) => boolean;
}

export interface Workflow<A> {
  id: string;
  title: string;
  defaults: A;
  steps: WorkflowStep<A>[];
  // Plain sentences for the final "This will:" screen.
  summary: (answers: A) => string[];
  run: (answers: A) => Promise<string>;
  // Answers not kept for next time (e.g. which file: it may be gone by then).
  transient?: (keyof A)[];
}

const storeKey = (id: string) => `mfp.workflow.${id}`;

export function rememberedAnswers<A>(workflow: Workflow<A>): A {
  try {
    const raw = window.localStorage.getItem(storeKey(workflow.id));
    return raw ? { ...workflow.defaults, ...(JSON.parse(raw) as Partial<A>) } : workflow.defaults;
  } catch {
    return workflow.defaults;
  }
}

function remember<A>(workflow: Workflow<A>, answers: A) {
  const kept = { ...answers };
  for (const key of workflow.transient ?? []) kept[key] = workflow.defaults[key];
  try {
    window.localStorage.setItem(storeKey(workflow.id), JSON.stringify(kept));
  } catch {
    // storage unavailable: defaults next time
  }
}

export function WorkflowDialog<A>({
  workflow,
  initial,
  onClose,
}: {
  workflow: Workflow<A>;
  // Overrides on top of the remembered answers (e.g. the plate the user is looking at).
  initial?: Partial<A>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [answers, setAnswers] = useState<A>(() => ({ ...rememberedAnswers(workflow), ...initial }));
  const [index, setIndex] = useState(0);
  const [explainOpen, setExplainOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const steps = useMemo(() => workflow.steps.filter((s) => !s.skip?.(answers)), [workflow.steps, answers]);
  const onSummary = index >= steps.length;
  const step = onSummary ? null : steps[index];
  const problem = step?.check?.(answers) ?? null;
  const set = (patch: Partial<A>) => setAnswers((prev) => ({ ...prev, ...patch }));

  useEffect(() => setExplainOpen(false), [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const runIt = async () => {
    setRunning(true);
    try {
      const message = await workflow.run(answers);
      remember(workflow, answers);
      toast(message, "success");
      onClose();
    } catch (err) {
      toast(String(err).replace(/^Error: (HTTP \d+: )?/, ""), "error");
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-900/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={workflow.title}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-ink-200 px-5 py-3">
          <Wand2 {...ICON_PROPS} className="text-brand-600" />
          <h2 className="flex-1 text-sm font-semibold text-ink-900">{workflow.title}</h2>
          <span className="text-caption">
            {onSummary ? "Check and run" : `Step ${index + 1} of ${steps.length}`}
          </span>
          <button type="button" className="btn-ghost px-1.5" aria-label="Close" disabled={running} onClick={onClose}>
            <X {...ICON_PROPS} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-ink-800">
          {step ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-card-title">{step.question}</h3>
              {step.render(answers, set)}
              {problem && <p className="text-[12px] text-danger-fg">{problem}</p>}
              <button
                type="button"
                className="inline-flex items-center gap-1.5 self-start text-[12px] text-brand-700 hover:underline"
                aria-expanded={explainOpen}
                onClick={() => setExplainOpen((v) => !v)}
              >
                <HelpCircle size={13} strokeWidth={1.8} aria-hidden />I don't know
              </button>
              {explainOpen && <p className="rounded-md bg-ink-50 px-3 py-2 text-[13px] text-ink-700">{step.explain}</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <h3 className="text-card-title">This will:</h3>
              <ul className="list-disc pl-5 text-ink-700">
                {workflow.summary(answers).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="text-caption mt-1">You can change anything afterwards; your answers are kept for next time.</p>
            </div>
          )}
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-ink-200 bg-ink-50/40 px-5 py-3">
          <button type="button" className="btn-ghost" disabled={running} onClick={onClose}>
            Cancel
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost border border-ink-200" disabled={index === 0 || running} onClick={() => setIndex(index - 1)}>
              Back
            </button>
            {onSummary ? (
              <button type="button" className="btn-primary" disabled={running} onClick={() => void runIt()}>
                {running ? "Working…" : "Run"}
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={problem !== null} onClick={() => setIndex(index + 1)}>
                Next
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
