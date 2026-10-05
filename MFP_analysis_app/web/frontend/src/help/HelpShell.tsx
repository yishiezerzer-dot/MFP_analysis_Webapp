import clsx from "clsx";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { HelpModule, HelpTopic } from "./types";
import { filterTopicTree, flattenTopics } from "./topicUtils";
import { useHelp } from "./HelpProvider";
import { CONTROLS, type ControlHint, type ControlTab } from "./controls";
import { Compass, Crosshair } from "lucide-react";
import { Hint } from "../components/Hint";

function TocRow({
  id,
  title,
  depth,
  active,
  onSelect,
}: {
  id: string;
  title: string;
  depth: number;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "w-full rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
        active ? "bg-brand-50 font-medium text-brand-800" : "text-ink-700 hover:bg-ink-100",
      )}
      style={{ paddingLeft: 8 + depth * 10 }}
      onClick={() => onSelect(id)}
    >
      {title}
    </button>
  );
}

function renderToc(topics: HelpTopic[], depth: number, activeId: string | null, onSelect: (id: string) => void) {
  const nodes: ReactNode[] = [];
  for (const t of topics) {
    nodes.push(
      <TocRow
        key={t.id}
        id={t.id}
        title={t.title}
        depth={depth}
        active={activeId === t.id}
        onSelect={onSelect}
      />,
    );
    if (t.children?.length) {
      nodes.push(...renderToc(t.children, depth + 1, activeId, onSelect));
    }
  }
  return nodes;
}

function ShowMe({ controls, onShow }: { controls: ControlHint[]; onShow: (id: string) => void }) {
  if (controls.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-caption">Show me:</span>
      {controls.map((c) => (
        <button
          key={c.id}
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-2.5 py-0.5 text-[12px] text-ink-700 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-800"
          onClick={() => onShow(c.id)}
        >
          <Crosshair size={12} strokeWidth={1.8} aria-hidden />
          {c.label}
        </button>
      ))}
    </div>
  );
}

function renderBodies(
  topics: HelpTopic[],
  controlsFor: (topicId: string) => ControlHint[],
  onShow?: (id: string) => void,
): ReactNode[] {
  const out: ReactNode[] = [];
  for (const t of topics) {
    out.push(
      <section key={t.id} id={`help-topic-${t.id}`} className="scroll-mt-3 border-b border-ink-100 pb-6 last:border-0">
        <h3 className="mb-2 text-sm font-semibold text-ink-900">{t.title}</h3>
        {t.body ? <div className="text-[13px]">{t.body}</div> : null}
        {onShow && <ShowMe controls={controlsFor(t.id)} onShow={onShow} />}
        {t.children?.length ? <div className="mt-3 space-y-6">{renderBodies(t.children, controlsFor, onShow)}</div> : null}
      </section>,
    );
  }
  return out;
}

export function HelpShell({
  open,
  module,
  initialTopic,
  tab,
  onShowControl,
  tourTitle,
  onStartTour,
  onClose,
}: {
  open: boolean;
  module: HelpModule;
  initialTopic?: string;
  // The tab this help belongs to; its controls get "Show me" buttons on their help topic.
  tab?: ControlTab | null;
  onShowControl?: (id: string) => void;
  tourTitle?: string;
  onStartTour?: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(() => filterTopicTree(module.topics, query), [module.topics, query]);

  const flat = useMemo(() => flattenTopics(module.topics), [module.topics]);
  const controlsFor = useCallback(
    (topicId: string) => CONTROLS.filter((c) => c.tab === tab && c.helpTopic === topicId),
    [tab],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const scrollToId = useCallback((id: string) => {
    setActiveId(id);
    window.requestAnimationFrame(() => {
      document.getElementById(`help-topic-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  useEffect(() => {
    if (open && initialTopic) scrollToId(initialTopic);
  }, [open, initialTopic, scrollToId]);

  const onSearchChange = (value: string) => {
    setQuery(value);
    const q = value.trim().toLowerCase();
    if (!q) {
      setActiveId(null);
      return;
    }
    const hit = flat.find((row) => row.haystack.includes(q));
    if (hit) scrollToId(hit.id);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-900/45 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-shell-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-2xl">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-ink-200 bg-ink-50/50 px-4 py-3">
          <h2 id="help-shell-title" className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">
            {module.title}
          </h2>
          <label className="flex min-w-[12rem] max-w-sm flex-1 items-center gap-2">
            <span className="sr-only">Search help</span>
            <input
              type="search"
              className="input h-9 flex-1 text-sm"
              placeholder="Search sections…"
              value={query}
              onChange={(e) => onSearchChange(e.target.value)}
              autoComplete="off"
            />
          </label>
          {tourTitle && onStartTour && (
            <button type="button" className="btn-ghost border border-ink-200" onClick={onStartTour} title={tourTitle}>
              <Compass size={15} strokeWidth={1.8} aria-hidden />
              Take the tour
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="flex min-h-0 flex-1 divide-x divide-ink-200">
          <nav
            className="hidden w-56 shrink-0 overflow-y-auto bg-ink-50/30 p-2 sm:block"
            aria-label="Help contents"
          >
            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
              Contents
            </div>
            {renderToc(filtered, 0, activeId, scrollToId)}
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {renderBodies(filtered, controlsFor, onShowControl)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HelpOpenButton() {
  const { openHelp } = useHelp();
  return (
    <Hint id="app.help" placement="bottom">
      <button
        type="button"
        className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100"
        onClick={() => openHelp()}
      >
        Help
      </button>
    </Hint>
  );
}
