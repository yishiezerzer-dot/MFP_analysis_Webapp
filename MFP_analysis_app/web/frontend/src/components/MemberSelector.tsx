import React, { useState, useRef, useEffect } from "react";
import clsx from "clsx";
import { useWorkspace } from "../context/WorkspaceContext";

export function MemberSelector() {
  const { workspaces, activeWorkspace, activeWorkspaceId, selectWorkspace, createWorkspace } =
    useWorkspace();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setAdding(false);
      setNameInput("");
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    await createWorkspace(trimmed);
    setNameInput("");
    setAdding(false);
    setOpen(false);
  };

  const displayName = activeWorkspace?.name || "Lab Profile";

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
          "border border-ink-200/70 shadow-xs",
          "bg-surface text-ink-800 hover:bg-ink-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        )}
        title="Switch Lab Member Profile"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-500/20 text-[10px] font-semibold text-brand-700 dark:text-brand-300">
          {displayName.charAt(0).toUpperCase()}
        </span>
        <span className="max-w-[120px] truncate font-semibold">{displayName}</span>
        <svg
          className={clsx("h-3 w-3 text-ink-400 transition-transform", open && "rotate-180")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className={clsx(
            "absolute right-0 z-50 mt-1.5 w-60 rounded-lg border border-ink-200/70 p-1 shadow-lg",
            "bg-surface-raised text-ink-900",
          )}
          style={{
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          }}
        >
          <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            Lab Member Profile
          </div>

          <div className="max-h-52 overflow-y-auto">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => {
                  selectWorkspace(ws.id);
                  setOpen(false);
                }}
                className={clsx(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  ws.id === activeWorkspaceId
                    ? "bg-brand-500/15 font-semibold text-brand-700 dark:text-brand-300"
                    : "text-ink-700 hover:bg-ink-100/60",
                )}
              >
                <div className="min-w-0 flex-1 truncate">
                  <span>{ws.name}</span>
                  {ws.session_count > 0 && (
                    <span className="ml-1.5 text-[11px] text-ink-400">
                      ({ws.session_count})
                    </span>
                  )}
                </div>
                {ws.id === activeWorkspaceId && (
                  <span className="text-brand-600 dark:text-brand-400">✓</span>
                )}
              </button>
            ))}
          </div>

          <div className="my-1 border-t border-ink-200/40" />

          {adding ? (
            <form onSubmit={handleCreate} className="p-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  autoFocus
                  placeholder="New member name..."
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-ink-300 px-2 py-1 text-[12px] bg-surface text-ink-900 focus:border-brand-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded bg-brand-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-brand-600"
                >
                  Add
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-brand-600 hover:bg-brand-500/10 dark:text-brand-400"
            >
              <span className="text-sm font-bold">+</span>
              <span>Add New Member</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
