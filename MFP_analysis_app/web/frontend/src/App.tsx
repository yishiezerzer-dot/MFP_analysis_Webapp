import { ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import type { PlotlyHTMLElement } from "plotly.js";
import clsx from "clsx";
import { LCMSView } from "./views/LCMSView";
import { PlateReaderView } from "./views/PlateReaderView";
import { DataStudioView } from "./views/DataStudioView";
import { FTIRView } from "./views/FTIRView";
import { AIView } from "./views/AIView";
import type { PageHeaderContextValue } from "./layout/PageHeader";
import { UserMenu, type AppUser } from "./layout/UserMenu";
import { Tooltip } from "./components/Tooltip";
import mfpLogo from "./assets/mfp-logo.png";

const CURRENT_USER: AppUser = {
  name: "Local User",
  secondary: "local@dev",
  presence: "online",
};

interface TabDef {
  to: string;
  label: string;
  hint: string;
  status: "ready" | "stub";
  icon: (props: { className?: string }) => JSX.Element;
}

const TABS: TabDef[] = [
  { to: "/lcms", label: "LCMS", hint: "mzML viewer", status: "ready", icon: IconLCMS },
  { to: "/ftir", label: "FTIR", hint: "spectra + peaks", status: "ready", icon: IconFTIR },
  { to: "/plate-reader", label: "Plate Reader", hint: "MIC wizard", status: "ready", icon: IconPlate },
  { to: "/data-studio", label: "Data Studio", hint: "plot builder", status: "ready", icon: IconTable },
  { to: "/ai", label: "AI Assistant", hint: "analysis helper", status: "ready", icon: IconSparkle },
];

const PIN_STORAGE_KEY = "mfp.sidebar.pinned";
const PLOTLY_RESIZE_SETTLE_DELAYS_MS = [48, 140, 280];
type PlotlyResizeModule = typeof import("plotly.js-dist-min").default;
let plotlyResizePromise: Promise<PlotlyResizeModule> | null = null;

function getPlotlyForResize() {
  if (!plotlyResizePromise) {
    plotlyResizePromise = import("plotly.js-dist-min").then((plotlyModule) => plotlyModule.default);
  }
  return plotlyResizePromise;
}

function resizePlotlyElement(el: HTMLElement) {
  if (!document.body.contains(el)) return;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  void getPlotlyForResize().then((Plotly) => {
    if (!document.body.contains(el)) return;
    void Plotly.Plots.resize(el as PlotlyHTMLElement);
  });
}

function resizeMountedPlotlyCharts() {
  document.querySelectorAll<HTMLElement>(".js-plotly-plot").forEach(resizePlotlyElement);
}

function usePlotlyAutoResize() {
  const location = useLocation();

  useEffect(() => {
    const timers = new Set<number>();
    const pendingFrames = new WeakMap<HTMLElement, number>();
    const observedPlots = new Map<HTMLElement, Element[]>();
    const targetPlots = new Map<Element, Set<HTMLElement>>();

    const scheduleResize = (plotEl: HTMLElement) => {
      if (pendingFrames.has(plotEl)) return;
      const frame = window.requestAnimationFrame(() => {
        pendingFrames.delete(plotEl);
        resizePlotlyElement(plotEl);
      });
      pendingFrames.set(plotEl, frame);
    };

    const scheduleResizeBurst = (plotEl: HTMLElement) => {
      scheduleResize(plotEl);
      PLOTLY_RESIZE_SETTLE_DELAYS_MS.forEach((delay) => {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          scheduleResize(plotEl);
        }, delay);
        timers.add(timer);
      });
    };

    const resizeObserver = new ResizeObserver((entries) => {
      const plots = new Set<HTMLElement>();
      entries.forEach((entry) => {
        targetPlots.get(entry.target)?.forEach((plotEl) => plots.add(plotEl));
      });
      plots.forEach(scheduleResizeBurst);
    });

    const observePlot = (plotEl: HTMLElement) => {
      if (observedPlots.has(plotEl)) return;
      const targets = new Set<Element>([plotEl]);
      if (plotEl.parentElement) targets.add(plotEl.parentElement);
      const card = plotEl.closest(".card");
      if (card) targets.add(card);

      targets.forEach((target) => {
        let plots = targetPlots.get(target);
        if (!plots) {
          plots = new Set<HTMLElement>();
          targetPlots.set(target, plots);
          resizeObserver.observe(target);
        }
        plots.add(plotEl);
      });

      observedPlots.set(plotEl, [...targets]);
      scheduleResizeBurst(plotEl);
    };

    const sweepPlots = () => {
      document.querySelectorAll<HTMLElement>(".js-plotly-plot").forEach(observePlot);
      observedPlots.forEach((targets, plotEl) => {
        if (document.body.contains(plotEl)) return;
        targets.forEach((target) => {
          const plots = targetPlots.get(target);
          plots?.delete(plotEl);
          if (plots && plots.size === 0) {
            resizeObserver.unobserve(target);
            targetPlots.delete(target);
          }
        });
        observedPlots.delete(plotEl);
      });
    };

    let pendingSweep: number | null = null;
    const scheduleSweep = () => {
      if (pendingSweep !== null) return;
      pendingSweep = window.requestAnimationFrame(() => {
        pendingSweep = null;
        sweepPlots();
      });
    };

    const mutationObserver = new MutationObserver(scheduleSweep);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", resizeMountedPlotlyCharts);
    window.addEventListener("orientationchange", resizeMountedPlotlyCharts);
    sweepPlots();

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", resizeMountedPlotlyCharts);
      window.removeEventListener("orientationchange", resizeMountedPlotlyCharts);
      if (pendingSweep !== null) window.cancelAnimationFrame(pendingSweep);
      observedPlots.forEach((_targets, plotEl) => {
        const frame = pendingFrames.get(plotEl);
        if (frame !== undefined) window.cancelAnimationFrame(frame);
      });
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    resizeMountedPlotlyCharts();
    const timers = PLOTLY_RESIZE_SETTLE_DELAYS_MS.map((delay) =>
      window.setTimeout(resizeMountedPlotlyCharts, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [location.pathname]);
}

function Sidebar() {
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(PIN_STORAGE_KEY);
    return stored === null ? true : stored === "1";
  });
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(PIN_STORAGE_KEY, pinned ? "1" : "0");
    } catch {
      // ignore (private mode / SSR)
    }
  }, [pinned]);

  const expanded = pinned || hovered;

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={clsx(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-ink-200/70",
        "transition-[width] duration-200 ease-out",
        expanded ? "w-64" : "w-[56px]",
      )}
      style={{ backgroundColor: "rgb(var(--surface))" }}
      aria-expanded={expanded}
    >
      {/* Logo area */}
      <div
        className={clsx(
          "flex items-center gap-2.5 border-b border-ink-200/60 py-3",
          expanded ? "px-3" : "justify-center px-0",
        )}
      >
        <img
          src={mfpLogo}
          alt="MFP Analysis"
          className="h-8 w-8 shrink-0 select-none object-contain rounded-[6px]"
          draggable={false}
        />
        <div
          className={clsx(
            "min-w-0 flex-1 overflow-hidden transition-opacity duration-150",
            expanded
              ? "opacity-100"
              : "pointer-events-none w-0 flex-none opacity-0",
          )}
        >
          <div className="truncate text-[13px] font-semibold tracking-tight text-ink-900">MFP Analysis</div>
          <div className="truncate text-[11px] text-ink-500 leading-tight">Lab Platform</div>
        </div>
        <Tooltip content={pinned ? "Unpin sidebar" : "Pin sidebar"} placement="bottom">
          <button
            type="button"
            onClick={() => setPinned((p) => !p)}
            aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
            aria-pressed={pinned}
            className={clsx(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700",
              !expanded && "hidden",
            )}
          >
            <IconPin pinned={pinned} className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Nav items */}
      <nav
        className={clsx(
          "flex flex-1 flex-col gap-0.5 py-2",
          expanded ? "px-2" : "px-1.5",
        )}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const navLink = (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                clsx(
                  "nav-item",
                  !expanded && "justify-center px-0",
                  isActive && "active",
                )
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <div
                className={clsx(
                  "min-w-0 flex-1 transition-opacity duration-150",
                  expanded ? "opacity-100" : "pointer-events-none hidden opacity-0",
                )}
              >
                <div className="truncate text-[13px]">{t.label}</div>
                <div className="truncate text-[11px] opacity-60 leading-tight">
                  {t.hint}
                </div>
              </div>
              {expanded && t.status === "stub" && (
                <span className="rounded-full bg-ink-200/60 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
                  soon
                </span>
              )}
            </NavLink>
          );
          return expanded ? navLink : (
            <Tooltip key={t.to} content={`${t.label} — ${t.hint}`} placement="right">
              {navLink}
            </Tooltip>
          );
        })}
      </nav>

      <UserMenu user={CURRENT_USER} expanded={expanded} />
    </aside>
  );
}

/**
 * Top-level shell.
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ Global header (full width)                    │
 *   ├──────────┬────────────────────────────────────┤
 *   │ Sidebar  │ <Outlet /> — current view          │
 *   │          │                                    │
 *   └──────────┴────────────────────────────────────┘
 *
 * Views register their header content with the `usePageHeader` hook, which
 * reads the outlet context we provide below.
 */
function Layout() {
  usePlotlyAutoResize();
  const [headerNode, setHeaderNode] = useState<ReactNode>(null);
  const ctx = useMemo<PageHeaderContextValue>(
    () => ({ setHeader: setHeaderNode }),
    [],
  );

  return (
    <div className="flex h-full w-full flex-col">
      <header className="shrink-0 border-b border-ink-200/70 shadow-sm" style={{ backgroundColor: "rgb(var(--surface))" }}>
        {headerNode ?? <div className="h-12" aria-hidden="true" />}
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden" style={{ backgroundColor: "rgb(var(--canvas))" }}>
          <Outlet context={ctx} />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/lcms" replace />} />
        <Route path="/lcms" element={<LCMSView />} />
        <Route path="/ftir" element={<FTIRView />} />
        <Route path="/plate-reader" element={<PlateReaderView />} />
        <Route path="/data-studio" element={<DataStudioView />} />
        <Route path="/ai" element={<AIView />} />
      </Route>
    </Routes>
  );
}

// ------------------------------ icons ------------------------------
// Inline SVGs so we don't pull in an icon library. 24×24 viewBox,
// `currentColor` strokes so they inherit text colour in both active
// (white-on-ink-900) and idle (ink-600) nav states.

function svgProps(className?: string) {
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

function IconLCMS({ className }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="M3 18h18" />
      <path d="M3 16l3-1 2 -8 2 6 2 -4 2 5 2 -9 2 7 4 -2" />
    </svg>
  );
}

function IconFTIR({ className }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="M3 12c2 0 2 -6 4 -6s2 12 4 12 2 -12 4 -12 2 6 4 6" />
      <path d="M3 20h18" opacity="0.5" />
    </svg>
  );
}

function IconPlate({ className }: { className?: string }) {
  const cx = [6, 10, 14, 18];
  const cy = [6, 10, 14, 18];
  return (
    <svg {...svgProps(className)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {cy.map((y) => cx.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />))}
    </svg>
  );
}

function IconTable({ className }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="M3 21h18" />
      <rect x="5" y="12" width="3" height="7" />
      <rect x="10.5" y="8" width="3" height="11" />
      <rect x="16" y="14" width="3" height="5" />
    </svg>
  );
}

function IconSparkle({ className }: { className?: string }) {
  return (
    <svg {...svgProps(className)}>
      <path d="M4 5h12a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3H9l-4 3v-3H4a1 1 0 0 1 -1 -1V8a3 3 0 0 1 1 -3z" />
      <path d="M13 8l0.7 1.6L15.3 10.3L13.7 11L13 12.6L12.3 11L10.7 10.3L12.3 9.6z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconPin({ pinned, className }: { pinned: boolean; className?: string }) {
  // Thumbtack icons modelled on Lucide's `Pin` / `PinOff`. When pinned, a
  // filled-head tack; when unpinned, the same tack with a diagonal slash.
  if (pinned) {
    return (
      <svg {...svgProps(className)}>
        <path d="M12 17v5" />
        <path
          d="M9 10.76a2 2 0 0 1 -1.11 1.79l-1.78 .9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1 -1v-.76a2 2 0 0 0 -1.11 -1.79l-1.78 -.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1 -1a2 2 0 0 0 0 -4H8a2 2 0 0 0 0 4a1 1 0 0 1 1 1z"
          fill="currentColor"
          fillOpacity={0.18}
        />
      </svg>
    );
  }
  return (
    <svg {...svgProps(className)}>
      <path d="M12 17v5" />
      <path d="M15 9.34V7a1 1 0 0 1 1 -1a2 2 0 0 0 0 -4H7.89" />
      <path d="M9 9v1.76a2 2 0 0 1 -1.11 1.79l-1.78 .9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h9" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
