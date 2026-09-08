import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { api, ExperimentBundle } from "../api";
import { Tooltip } from "./Tooltip";

interface ExperimentTagEditorProps {
  sessionId: string | null;
  currentTag?: string;
  module: "lcms" | "ftir" | "plate-reader" | "data-studio";
  onTagUpdated?: (newTag: string) => void;
  className?: string;
}

export const ExperimentTagEditor: React.FC<ExperimentTagEditorProps> = ({
  sessionId,
  currentTag = "",
  module,
  onTagUpdated,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tagInput, setTagInput] = useState(currentTag);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [bundle, setBundle] = useState<ExperimentBundle | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setTagInput(currentTag);
  }, [currentTag]);

  // Load existing tags
  useEffect(() => {
    let cancelled = false;
    void api.experiments.listTags().then((tags) => {
      if (!cancelled) setAvailableTags(tags);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Fetch sibling bundle if tag is present
  useEffect(() => {
    if (!currentTag) {
      setBundle(null);
      return;
    }
    let cancelled = false;
    void api.experiments.getBundle(currentTag).then((res) => {
      if (!cancelled) setBundle(res);
    });
    return () => {
      cancelled = true;
    };
  }, [currentTag]);

  // Click outside to close popover
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleSave = useCallback(
    async (tagToSave: string) => {
      if (!sessionId) return;
      setIsSaving(true);
      try {
        const clean = tagToSave.trim();
        await api.experiments.updateSessionTag(sessionId, clean);
        onTagUpdated?.(clean);
        setIsOpen(false);
      } catch (err) {
        console.error("Failed to update experiment tag:", err);
      } finally {
        setIsSaving(false);
      }
    },
    [sessionId, onTagUpdated],
  );

  if (!sessionId) return null;

  const totalLinked = bundle ? bundle.sessions.length : 0;
  const isTagged = Boolean(currentTag.trim());

  return (
    <div className={clsx("relative inline-flex items-center", className)} ref={popoverRef}>
      <Tooltip
        content={
          isTagged
            ? `Experiment: ${currentTag} (${totalLinked} total linked sessions across modules)`
            : "Click to tag this session with an Experiment ID"
        }
        placement="bottom"
      >
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all shadow-sm",
            isTagged
              ? "border border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
              : "border border-dashed border-ink-300 bg-ink-50 text-ink-600 hover:border-ink-400 hover:bg-ink-100 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300",
          )}
        >
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
            />
          </svg>
          <span className="max-w-[140px] truncate font-semibold">
            {isTagged ? currentTag : "+ Experiment Tag"}
          </span>

          {bundle && totalLinked > 1 && (
            <span className="ml-0.5 rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-800 dark:text-amber-200">
              {totalLinked}
            </span>
          )}
        </button>
      </Tooltip>

      {/* Popover */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-ink-200 bg-surface p-3 shadow-xl ring-1 ring-black/5 dark:border-ink-700 dark:bg-ink-900 animate-in fade-in zoom-in-95">
          <div className="text-xs font-semibold text-ink-900 dark:text-ink-100 mb-1.5 flex items-center justify-between">
            <span>Experiment Tagging</span>
            {isTagged && (
              <button
                type="button"
                onClick={() => void handleSave("")}
                className="text-[11px] text-red-500 hover:underline"
              >
                Clear Tag
              </button>
            )}
          </div>
          <p className="text-[11px] text-ink-500 mb-2">
            Link this session with matching LC-MS, FTIR, or plate assays under a unified experiment name.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave(tagInput);
            }}
            className="flex gap-1.5"
          >
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="e.g. Sample_4B_C18_Run"
              list="exp-tag-suggestions"
              className="flex-1 rounded-md border border-ink-300 bg-canvas px-2 py-1 text-xs text-ink-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-ink-700 dark:text-ink-100"
            />
            <datalist id="exp-tag-suggestions">
              {availableTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Save
            </button>
          </form>

          {/* Sibling sessions linked to this experiment */}
          {bundle && bundle.sessions.length > 0 && (
            <div className="mt-3 border-t border-ink-100 pt-2 dark:border-ink-800">
              <div className="text-[11px] font-medium text-ink-500 mb-1.5 flex items-center justify-between">
                <span>Linked Data in this Experiment:</span>
                <span className="font-mono text-[10px]">{bundle.sessions.length} sessions</span>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {bundle.sessions.map((item) => {
                  const isCurrent = item.session_id === sessionId;
                  const route =
                    item.module === "lcms"
                      ? "/lcms"
                      : item.module === "ftir"
                      ? "/ftir"
                      : item.module === "plate_reader"
                      ? "/plate-reader"
                      : "/data-studio";

                  const icon =
                    item.module === "lcms"
                      ? "🔬"
                      : item.module === "ftir"
                      ? "〰️"
                      : item.module === "plate_reader"
                      ? "🧫"
                      : "📊";

                  return (
                    <div
                      key={item.session_id}
                      onClick={() => {
                        if (!isCurrent) {
                          setIsOpen(false);
                          navigate(route);
                        }
                      }}
                      className={clsx(
                        "flex items-center justify-between rounded px-2 py-1 text-xs transition-colors",
                        isCurrent
                          ? "bg-brand-500/10 font-semibold text-brand-700 dark:text-brand-300"
                          : "hover:bg-ink-100 dark:hover:bg-ink-800 cursor-pointer text-ink-700 dark:text-ink-300",
                      )}
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <span>{icon}</span>
                        <span className="truncate max-w-[160px]">{item.display_name}</span>
                      </span>
                      {isCurrent ? (
                        <span className="text-[10px] text-brand-600 dark:text-brand-400">active</span>
                      ) : (
                        <span className="text-[10px] text-ink-400 hover:text-ink-600">jump ↗</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
