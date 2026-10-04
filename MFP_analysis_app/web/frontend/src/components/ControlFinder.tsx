import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Search } from "lucide-react";
import { Hint } from "./Hint";
import { useToast } from "./Toast";
import { ICON_PROPS } from "./common/ChartCardParts";
import { CONTROLS, TAB_LABELS, TAB_ROUTES, tabOfRoute } from "../help/controls";
import { searchFinder, type FinderResult } from "../help/controlSearch";
import { revealControl } from "../help/reveal";
import { useHelp } from "../help/HelpProvider";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// Header search for any control or help topic; Ctrl/⌘K opens it from anywhere.
export function ControlFinder() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { openHelp } = useHelp();
  const currentTab = tabOfRoute(location.pathname);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = async (r: FinderResult) => {
    setOpen(false);
    if (r.kind === "topic") {
      openHelp(r.id, r.route);
      return;
    }
    const route = TAB_ROUTES[r.control.tab];
    if (route && route !== location.pathname.replace(/\/$/, "")) navigate(route);
    const result = await revealControl(r.control.id);
    if (result === "not-found") {
      toast(`"${r.control.label}" appears once a file is open on the ${TAB_LABELS[r.control.tab]} tab.`, "info");
    }
  };

  return (
    <>
      <Hint id="app.findControl" placement="bottom">
        <button
          type="button"
          className="flex h-9 w-60 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2.5 text-left text-sm text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-700"
          onClick={() => setOpen(true)}
        >
          <Search {...ICON_PROPS} />
          <span className="flex-1 truncate">Find a control…</span>
          <kbd className="kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
      </Hint>
      {open && <FinderDialog currentTab={currentTab} onChoose={choose} onClose={() => setOpen(false)} />}
    </>
  );
}

function FinderDialog({
  currentTab,
  onChoose,
  onClose,
}: {
  currentTab: ReturnType<typeof tabOfRoute>;
  onChoose: (r: FinderResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo<FinderResult[]>(() => {
    if (query.trim()) return searchFinder(query, currentTab);
    return CONTROLS.filter((c) => c.tab === currentTab)
      .slice(0, 10)
      .map((control) => ({ kind: "control" as const, control, score: 0 }));
  }, [query, currentTab]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      onChoose(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-start justify-center bg-ink-900/40 p-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Find a control"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-ink-200 px-3">
          <Search {...ICON_PROPS} className="text-ink-500" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="finder-results"
            aria-activedescendant={results[active] ? `finder-${active}` : undefined}
            className="h-12 flex-1 bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-500"
            placeholder="Find a control or help topic, e.g. baseline, exclude well, export SVG"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        {!query.trim() && results.length > 0 && (
          <div className="text-caption px-4 pt-2">On this tab</div>
        )}
        <ul id="finder-results" role="listbox" ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-ink-500">
              {query.trim() ? "Nothing matches. Try another word, or press F1 for this tab's help." : "Type to search."}
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={r.kind === "control" ? r.control.id : `${r.route}#${r.id}`}
              id={`finder-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={clsx(
                "flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2",
                i === active ? "bg-brand-50" : "hover:bg-ink-100",
              )}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onChoose(r);
              }}
            >
              {r.kind === "control" ? (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink-900">{r.control.label}</span>
                    <span className="block truncate text-[12px] text-ink-600">{r.control.what}</span>
                  </span>
                  {r.control.tab !== currentTab && r.control.tab !== "app" && (
                    <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[12px] text-ink-600">
                      {TAB_LABELS[r.control.tab]}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <BookOpen {...ICON_PROPS} className="mt-0.5 shrink-0 text-ink-500" />
                  <span className="min-w-0 flex-1 text-[13px] text-ink-900">Help: {r.title}</span>
                  <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[12px] text-ink-600">
                    {TAB_LABELS[r.tab]}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="text-caption flex gap-3 border-t border-ink-200 px-4 py-2">
          <span>↑↓ to move</span>
          <span>Enter to go there</span>
          <span>F1 on any control for its help</span>
        </div>
      </div>
    </div>
  );
}
