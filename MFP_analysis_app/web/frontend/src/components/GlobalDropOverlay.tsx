import React from "react";
import clsx from "clsx";
import {
  useFileIngestion,
  ROUTING_RULES,
  IngestionRoute,
} from "../context/FileIngestionContext";

export const GlobalDropOverlay: React.FC = () => {
  const { isDragging, hoveredTarget, setHoveredTarget } = useFileIngestion();

  if (!isDragging) return null;

  const routes: IngestionRoute[] = [
    "/lcms",
    "/ftir",
    "/plate-reader",
    "/data-studio",
  ];

  return (
    <div
      className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-ink-950/75 p-6 backdrop-blur-md transition-all duration-200 animate-in fade-in"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        // If leaving the overlay container itself
        if (e.currentTarget === e.target) {
          setHoveredTarget("auto");
        }
      }}
    >
      <div className="relative flex max-w-4xl w-full flex-col items-center rounded-2xl border-2 border-dashed border-ink-500/50 bg-ink-900/90 p-8 shadow-2xl">
        {/* Glow pulse behind */}
        <div className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-r from-brand-500/20 via-sky-500/20 to-purple-500/20 opacity-50 blur-xl" />

        {/* Central icon & prompt */}
        <div className="relative mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-400 ring-1 ring-brand-500/30">
            <svg
              className="h-8 w-8 animate-bounce"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Drop Analytical Files to Analyze
          </h2>
          <p className="mt-1 max-w-md text-sm text-ink-300">
            Drop anywhere to auto-route by file extension, or hover over a specific instrument target below.
          </p>
        </div>

        {/* Target Cards Grid */}
        <div className="relative grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {routes.map((route) => {
            const rule = ROUTING_RULES[route];
            const isHovered = hoveredTarget === route;

            return (
              <div
                key={route}
                onDragEnter={(e) => {
                  e.stopPropagation();
                  setHoveredTarget(route);
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  if (hoveredTarget === route) {
                    setHoveredTarget("auto");
                  }
                }}
                className={clsx(
                  "group relative flex flex-col rounded-xl border p-4 text-left transition-all duration-150 cursor-pointer",
                  isHovered
                    ? "border-brand-400 bg-brand-500/20 ring-2 ring-brand-400/50 scale-[1.03]"
                    : "border-ink-700/60 bg-ink-800/60 hover:border-ink-500/80 hover:bg-ink-800",
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="rounded-md bg-ink-700/80 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-ink-200">
                    {rule.badge}
                  </span>
                  {isHovered && (
                    <span className="text-[11px] font-medium text-brand-300 animate-pulse">
                      Targeted
                    </span>
                  )}
                </div>

                <div className="text-sm font-semibold text-white group-hover:text-brand-300">
                  {rule.label}
                </div>
                <div className="mt-1 text-xs text-ink-400 line-clamp-2">
                  {rule.description}
                </div>

                <div className="mt-3 flex flex-wrap gap-1">
                  {rule.extensions.map((ext) => (
                    <span
                      key={ext}
                      className="rounded bg-ink-950/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-300 border border-ink-800"
                    >
                      {ext}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Global auto-routing indicator */}
        <div className="mt-6 flex items-center gap-2 text-xs text-ink-400">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span>Auto-routing active: </span>
          <span className="font-mono text-ink-300">
            {hoveredTarget === "auto" || !hoveredTarget
              ? "Auto-classify by extension"
              : `Force destination -> ${ROUTING_RULES[hoveredTarget].label}`}
          </span>
        </div>
      </div>
    </div>
  );
};
