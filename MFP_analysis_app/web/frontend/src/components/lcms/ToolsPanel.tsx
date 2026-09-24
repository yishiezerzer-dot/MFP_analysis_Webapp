import { ChangeEvent, ReactNode, useState } from "react";
import Plot from "react-plotly.js";
import clsx from "clsx";
import { LCMSSessionSummary } from "../../api";
import { ExperimentTagEditor } from "../ExperimentTagEditor";
import { type PolymerUiSettings } from "../../lcms/analysis";
import { Polarity, RtUnit, UvTimeUnit, TabId, UVLabelOrientation, formatRange } from "../../lcms/viewShared";
import { IconChevronLeft, IconChevronRight } from "./SessionsSidebar";

export function DatasetRibbon(props: {
  active: LCMSSessionSummary | null;
  onTagUpdated?: (newTag: string) => void;
  polarity: Polarity;
  setPolarity: (p: Polarity) => void;
  dualLayout: "stacked" | "grid";
  setDualLayout: (l: "stacked" | "grid") => void;
}) {
  const a = props.active;
  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 px-4 py-3">
      <div className="flex flex-wrap items-center gap-6">
        <Field label="Dataset" value={a?.display_name ?? "—"} strong />
        {a && (
          <div>
            <div className="label">Experiment Tag</div>
            <div className="mt-1">
              <ExperimentTagEditor
                sessionId={a.session_id}
                currentTag={a.experiment_tag}
                module="lcms"
                onTagUpdated={props.onTagUpdated}
              />
            </div>
          </div>
        )}
        <Field label="MS1 scans" value={a?.ms1_count ?? "—"} />
        <Field
          label="RT range (min)"
          value={formatRange(a?.rt_min ?? null, a?.rt_max ?? null)}
        />
        <Field
          label="Polarities in file"
          value={a?.polarities?.length ? a.polarities.join(", ") : "—"}
        />
        <Field
          label="UV"
          value={a?.uv?.available ? a.uv.filename ?? "attached" : "—"}
        />
      </div>

      {/* Quick Polarity & Dual Layout Controls */}
      <div className="flex items-center gap-2.5 pt-1 lg:pt-0">
        <div className="flex items-center rounded-lg bg-ink-100/80 p-0.5 text-xs">
          {(["all", "positive", "negative", "dual"] as Polarity[]).map((v) => (
            <button
              key={v}
              type="button"
              className={clsx(
                "py-1 px-2 rounded-md font-medium transition-all text-xs whitespace-nowrap",
                props.polarity === v
                  ? "bg-surface text-ink-900 shadow-xs font-semibold"
                  : "text-ink-600 hover:text-ink-900",
              )}
              onClick={() => props.setPolarity(v)}
            >
              {v === "all"
                ? "All"
                : v === "positive"
                ? "ESI+"
                : v === "negative"
                ? "ESI-"
                : "Dual (+/−)"}
            </button>
          ))}
        </div>
        {props.polarity === "dual" && (
          <div className="flex items-center rounded-lg bg-ink-100/80 p-0.5 text-xs">
            <button
              type="button"
              className={clsx(
                "py-1 px-2 rounded-md font-medium transition-all text-xs whitespace-nowrap",
                props.dualLayout === "stacked"
                  ? "bg-surface text-ink-900 shadow-xs font-semibold"
                  : "text-ink-600 hover:text-ink-900",
              )}
              onClick={() => props.setDualLayout("stacked")}
              title="Stacked cards layout (full width)"
            >
              ≡ Stacked
            </button>
            <button
              type="button"
              className={clsx(
                "py-1 px-2 rounded-md font-medium transition-all text-xs whitespace-nowrap",
                props.dualLayout === "grid"
                  ? "bg-surface text-ink-900 shadow-xs font-semibold"
                  : "text-ink-600 hover:text-ink-900",
              )}
              onClick={() => props.setDualLayout("grid")}
              title="Side-by-side 2-column grid layout"
            >
              ◫ 2-Col
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  strong,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={clsx("text-sm", strong && "font-medium")}>{value}</div>
    </div>
  );
}

// --- Right: tools panel ------------------------------------------------------

export interface ToolsPanelProps {
  // primary
  onEIC: () => void;
  onJumpMz: () => void;
  onExportLabels: () => void;
  onExportSpectrum: () => void;
  onExportUV: () => void;
  onExportTICOverlay: () => void;
  onSumRegionSpectrum: () => void;
  onFeatureTable: () => void;
  onComparisonMatrix: () => void;
  featureCount: number;
  busy: boolean;
  activeLoaded: boolean;
  // chrome
  workflowHidden: boolean;
  setWorkflowHidden: (v: boolean) => void;
  showPolymerControls: boolean;
  setShowPolymerControls: (v: boolean) => void;
  showConfidenceControls: boolean;
  setShowConfidenceControls: (v: boolean) => void;
  showAlignmentDiagnostics: boolean;
  setShowAlignmentDiagnostics: (v: boolean) => void;
  // tabs
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;
  // nav
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
  onFindMz: () => void;
  onAutoAlignUV: () => void;
  onEICDialog: () => void;
  rtJumpText: string;
  setRtJumpText: (v: string) => void;
  onRtJump: () => void;
  rtUnit: RtUnit;
  // view
  polarity: Polarity;
  setPolarity: (p: Polarity) => void;
  dualLayout: "stacked" | "grid";
  setDualLayout: (l: "stacked" | "grid") => void;
  setRtUnit: (u: RtUnit) => void;
  uvTimeUnit: UvTimeUnit;
  setUvTimeUnit: (u: UvTimeUnit) => void;
  uvOffsetText: string;
  setUvOffsetText: (v: string) => void;
  onApplyOffset: () => void;
  autoAlignUv: boolean;
  setAutoAlignUv: (v: boolean) => void;
  onGraphSettings: () => void;
  showTIC: boolean;
  setShowTIC: (v: boolean) => void;
  showSpectrum: boolean;
  setShowSpectrum: (v: boolean) => void;
  showUV: boolean;
  setShowUV: (v: boolean) => void;
  regionSelect: boolean;
  setRegionSelect: (v: boolean) => void;
  regionIgnoredMzText: string;
  setRegionIgnoredMzText: (v: string) => void;
  regionIgnoredMzTolerance: number;
  setRegionIgnoredMzTolerance: (v: number) => void;
  regionIgnoredCount: number;
  overlayTicEnabled: boolean;
  setOverlayTicEnabled: (v: boolean) => void;
  overlayUvEnabled: boolean;
  setOverlayUvEnabled: (v: boolean) => void;
  overlaySpectrumEnabled: boolean;
  setOverlaySpectrumEnabled: (v: boolean) => void;
  overlayEicEnabled: boolean;
  setOverlayEicEnabled: (v: boolean) => void;
  overlaySessionIds: string[];
  setOverlaySessionIds: (ids: string[]) => void;
  sessions: LCMSSessionSummary[];
  // annotate – spectrum
  annotateSpectrum: boolean;
  setAnnotateSpectrum: (v: boolean) => void;
  spectrumTopN: number;
  setSpectrumTopN: (v: number) => void;
  spectrumMinRel: number;
  setSpectrumMinRel: (v: number) => void;
  enableDragLabels: boolean;
  setEnableDragLabels: (v: boolean) => void;
  // annotate – uv
  transferMsToUv: boolean;
  setTransferMsToUv: (v: boolean) => void;
  uvTransferCount: number;
  setUvTransferCount: (v: number) => void;
  uvProminence: number;
  setUvProminence: (v: number) => void;
  uvMinDistance: number;
  setUvMinDistance: (v: number) => void;
  snapUvLabels: boolean;
  setSnapUvLabels: (v: boolean) => void;
  uvBunchLabels: boolean;
  setUvBunchLabels: (v: boolean) => void;
  uvBunchHubOffset: number;
  setUvBunchHubOffset: (v: number) => void;
  uvLabelOrientation: UVLabelOrientation;
  setUvLabelOrientation: (v: UVLabelOrientation) => void;
  uvLabelStairXStep: number;
  setUvLabelStairXStep: (v: number) => void;
  uvLabelStairYStep: number;
  setUvLabelStairYStep: (v: number) => void;
  onLabelSelectedRT: () => void;
  onAutoLabelUV: () => void;
  onCustomUvLabel: () => void;
  onAutoArrangeLabels: () => void;
  canAddCustomUvLabel: boolean;
  uvLabelCount: number;
  // annotate – overlay
  showOverlayLabels: boolean;
  setShowOverlayLabels: (v: boolean) => void;
  multiDragOverlay: boolean;
  setMultiDragOverlay: (v: boolean) => void;
  // polymer
  polymerSettings: PolymerUiSettings;
  setPolymerSettings: (v: PolymerUiSettings) => void;
  onPolymerDialog: () => void;
  onExpectedProducts: () => void;
  onKendrick: () => void;
  canOpenExpectedProducts: boolean;
  canOpenKendrick: boolean;
  onSavePolymerDefaults: () => void;
}

export function ToolsPanel(p: ToolsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      aria-expanded={!collapsed}
      className={clsx(
        "flex shrink-0 flex-col border-l border-ink-200 bg-ink-50/40",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-10 overflow-hidden" : "w-80 overflow-auto",
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center py-2">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="Expand tools panel"
            aria-label="Expand tools panel"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-200/60 hover:text-ink-800"
          >
            <IconChevronLeft className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <PrimaryActions
            onEIC={p.onEIC}
            onJumpMz={p.onJumpMz}
            onExportLabels={p.onExportLabels}
            onExportSpectrum={p.onExportSpectrum}
            onExportUV={p.onExportUV}
            onExportTICOverlay={p.onExportTICOverlay}
            onSumRegionSpectrum={p.onSumRegionSpectrum}
            onFeatureTable={p.onFeatureTable}
            onComparisonMatrix={p.onComparisonMatrix}
            featureCount={p.featureCount}
            busy={p.busy}
            activeLoaded={p.activeLoaded}
            onCollapse={() => setCollapsed(true)}
          />

          <WorkflowTools
            hidden={p.workflowHidden}
            setHidden={p.setWorkflowHidden}
            showPolymerControls={p.showPolymerControls}
            setShowPolymerControls={p.setShowPolymerControls}
            showConfidenceControls={p.showConfidenceControls}
            setShowConfidenceControls={p.setShowConfidenceControls}
            showAlignmentDiagnostics={p.showAlignmentDiagnostics}
            setShowAlignmentDiagnostics={p.setShowAlignmentDiagnostics}
            activeTab={p.activeTab}
            setActiveTab={p.setActiveTab}
          >
            {p.activeTab === "view" ? (
              <DisplayTab {...p} />
            ) : (
              <ToolsTab {...p} />
            )}
          </WorkflowTools>
        </>
      )}
    </aside>
  );
}

export function PrimaryActions({
  onEIC,
  onJumpMz,
  onExportLabels,
  onExportSpectrum,
  onExportUV,
  onExportTICOverlay,
  onSumRegionSpectrum,
  onFeatureTable,
  onComparisonMatrix,
  featureCount,
  busy,
  activeLoaded,
  onCollapse,
}: {
  onEIC: () => void;
  onJumpMz: () => void;
  onExportLabels: () => void;
  onExportSpectrum: () => void;
  onExportUV: () => void;
  onExportTICOverlay: () => void;
  onSumRegionSpectrum: () => void;
  onFeatureTable: () => void;
  onComparisonMatrix: () => void;
  featureCount: number;
  busy: boolean;
  activeLoaded: boolean;
  onCollapse?: () => void;
}) {
  return (
    <section className="border-b border-ink-200 bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Primary Actions</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            The highest-value actions stay visible here at all times.
          </p>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            title="Collapse tools panel"
            aria-label="Collapse tools panel"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
          >
            <IconChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <button
          className="rounded-md border border-brand-500 bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:border-ink-200 disabled:bg-ink-100 disabled:text-ink-400"
          disabled={!activeLoaded || busy}
          onClick={onEIC}
        >
          EIC (new chromatogram)…
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={!activeLoaded || busy}
            onClick={onJumpMz}
          >
            Jump to m/z…
          </button>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={!activeLoaded}
            onClick={onFeatureTable}
          >
            Feature table{featureCount > 0 ? ` (${featureCount})` : ""}...
          </button>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={!activeLoaded}
            onClick={onComparisonMatrix}
          >
            Comparison matrix...
          </button>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={!activeLoaded || busy}
            onClick={onExportLabels}
          >
            Export labels (all scans)…
          </button>
        </div>
      </div>
    </section>
  );
}

export function WorkflowTools({
  hidden,
  setHidden,
  showPolymerControls,
  setShowPolymerControls,
  showConfidenceControls,
  setShowConfidenceControls,
  showAlignmentDiagnostics,
  setShowAlignmentDiagnostics,
  activeTab,
  setActiveTab,
  children,
}: {
  hidden: boolean;
  setHidden: (v: boolean) => void;
  showPolymerControls: boolean;
  setShowPolymerControls: (v: boolean) => void;
  showConfidenceControls: boolean;
  setShowConfidenceControls: (v: boolean) => void;
  showAlignmentDiagnostics: boolean;
  setShowAlignmentDiagnostics: (v: boolean) => void;
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-1 flex-col">
      <header className="flex items-start justify-between gap-2 bg-surface p-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Workflow &amp; Tools</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Fine-tune visibility and advanced LCMS controls
          </p>
        </div>
        <button
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-dashed border-ink-300 bg-surface px-2 text-xs text-ink-700 hover:bg-ink-100"
          onClick={() => setHidden(!hidden)}
        >
          {hidden ? "Show ▼" : "Hide ▲"}
        </button>
      </header>

      {!hidden && (
        <>
          <div className="flex flex-col gap-1 bg-surface/70px-4 pb-2">
            <Check
              label="Show polymer matching controls"
              checked={showPolymerControls}
              onChange={setShowPolymerControls}
            />
            <Check
              label="Show confidence controls"
              checked={showConfidenceControls}
              onChange={setShowConfidenceControls}
            />
            <Check
              label="Show alignment diagnostics controls"
              checked={showAlignmentDiagnostics}
              onChange={setShowAlignmentDiagnostics}
            />
          </div>

          <div className="flex items-center gap-1 border-b border-ink-200 bg-surface/70 px-3 pt-2">
            {[
              { id: "navigate" as const, label: "Tools & Analysis" },
              { id: "view" as const, label: "Display & Overlays" },
            ].map((t) => {
              const isSelected =
                t.id === "view"
                  ? activeTab === "view"
                  : activeTab === "navigate" || activeTab === "annotate" || activeTab === "polymer";
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={clsx(
                    "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                    isSelected
                      ? "border-brand-500 text-ink-900"
                      : "border-transparent text-ink-500 hover:text-ink-800",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 p-4">{children}</div>
        </>
      )}
    </section>
  );
}

// --- Tabs --------------------------------------------------------------------

export function ToolsTab(p: ToolsPanelProps) {
  const polymerDisabled = p.polarity === "all";
  const polymerStatus =
    p.polarity === "positive"
      ? "Positive mode: +H, optional +Na/+K."
      : p.polarity === "negative"
        ? "Negative mode: -H, optional +Cl/+HCOO/+Ac."
        : "Choose Positive or Negative polarity to enable polymer matching.";

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Scan Navigation */}
      <GroupBox title="Scan Navigation">
        <div className="grid grid-cols-4 gap-2">
          <NavyButton onClick={p.onPrev} disabled={!p.activeLoaded}>
            ◄ Prev
          </NavyButton>
          <NavyButton onClick={p.onNext} disabled={!p.activeLoaded}>
            Next ►
          </NavyButton>
          <NavyButton onClick={p.onFirst} disabled={!p.activeLoaded}>
            First
          </NavyButton>
          <NavyButton onClick={p.onLast} disabled={!p.activeLoaded}>
            Last
          </NavyButton>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-ink-500">
          <span>Tip: use ← / → keys to step</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NavyButton onClick={p.onFindMz} disabled={!p.activeLoaded}>
            Find m/z…
          </NavyButton>
          <NavyButton onClick={p.onEICDialog} disabled={!p.activeLoaded}>
            EIC…
          </NavyButton>
        </div>
      </GroupBox>

      {/* 2. Jump to RT */}
      <GroupBox title="Jump to RT">
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-700">
            RT ({p.rtUnit === "seconds" ? "s" : "min"}):
          </label>
          <input
            type="number"
            className="input flex-1"
            aria-label={`Jump to retention time (${p.rtUnit === "seconds" ? "s" : "min"})`}
            placeholder="e.g. 2.45"
            value={p.rtJumpText}
            onChange={(e) => p.setRtJumpText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") p.onRtJump();
            }}
            disabled={!p.activeLoaded}
          />
          <NavyButton onClick={p.onRtJump} disabled={!p.activeLoaded}>
            Go
          </NavyButton>
        </div>
      </GroupBox>

      {/* 3. Spectrum Peak Labels */}
      <GroupBox title="Spectrum Peak Labels">
        <Check
          label="Annotate spectrum peaks with m/z"
          checked={p.annotateSpectrum}
          onChange={p.setAnnotateSpectrum}
        />
        <Row label="Top N">
          <input
            type="number"
            min={1}
            className="input w-24"
            value={p.spectrumTopN}
            onChange={(e) =>
              p.setSpectrumTopN(Math.max(1, parseInt(e.target.value || "0", 10) || 0))
            }
          />
        </Row>
        <Row label="Min rel">
          <input
            type="number"
            step="0.01"
            min={0}
            className="input w-24"
            value={p.spectrumMinRel}
            onChange={(e) =>
              p.setSpectrumMinRel(Math.max(0, parseFloat(e.target.value || "0") || 0))
            }
          />
        </Row>
        <Check
          label="Enable dragging labels with mouse"
          checked={p.enableDragLabels}
          onChange={p.setEnableDragLabels}
        />
      </GroupBox>

      {/* 4. Polymer & Reaction Matching */}
      {p.showPolymerControls && (
        <GroupBox title="Polymer & Reaction Matching">
          <label
            className={clsx(
              "flex items-center gap-2 text-sm text-ink-800",
              polymerDisabled && "opacity-60",
            )}
          >
            <input
              type="checkbox"
              checked={p.polymerSettings.shared.enabled && !polymerDisabled}
              disabled={polymerDisabled}
              onChange={(e) =>
                p.setPolymerSettings({
                  ...p.polymerSettings,
                  shared: { ...p.polymerSettings.shared, enabled: e.target.checked },
                })
              }
            />
            <span>Enable polymer/reaction matching</span>
          </label>
          <p className="mt-1 text-xs text-ink-500">{polymerStatus}</p>
          <NavyButton className="mt-2 w-full" onClick={p.onPolymerDialog}>
            Polymer Match…
          </NavyButton>
          <button
            type="button"
            className="mt-2 w-full rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            onClick={p.onExpectedProducts}
            disabled={!p.canOpenExpectedProducts}
            title={
              p.canOpenExpectedProducts
                ? "Match expected monomer/dimer/trimer products against the current MS1 spectrum"
                : "Select polarity, monomers, and load an MS1 spectrum first"
            }
          >
            Expected Products...
          </button>
          <button
            type="button"
            className="mt-2 w-full rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            onClick={p.onKendrick}
            disabled={!p.canOpenKendrick}
            title={
              p.canOpenKendrick
                ? "Open a Kendrick mass defect plot for the current MS1 spectrum"
                : "Load an MS1 spectrum first"
            }
          >
            Kendrick Plot...
          </button>
          <button
            type="button"
            className="mt-2 w-full rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={p.onSavePolymerDefaults}
          >
            Save current as defaults
          </button>
        </GroupBox>
      )}
    </div>
  );
}

export function DisplayTab(p: ToolsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <GroupBox title="Filters & Units">
        <Row label="RT display unit">
          <select
            className="input"
            title="How retention times are shown. The time unit stored in each mzML file is read automatically."
            value={p.rtUnit}
            onChange={(e) => p.setRtUnit(e.target.value as RtUnit)}
          >
            <option value="minutes">minutes</option>
            <option value="seconds">seconds</option>
          </select>
        </Row>
        <Row label="UV CSV time unit">
          <select
            className="input"
            title="Time unit of the first column in attached UV/DAD CSV files. Auto reads it from the header (e.g. 'Time (sec)') and otherwise assumes minutes."
            value={p.uvTimeUnit}
            onChange={(e) => p.setUvTimeUnit(e.target.value as UvTimeUnit)}
          >
            <option value="auto">auto (header, else minutes)</option>
            <option value="minutes">minutes</option>
            <option value="seconds">seconds</option>
          </select>
        </Row>
      </GroupBox>

      <GroupBox title="Polarity">
        <div className="flex flex-wrap items-center gap-4">
          {(["all", "positive", "negative", "dual"] as Polarity[]).map((v) => (
            <label key={v} className="flex items-center gap-1.5 text-sm capitalize">
              <input
                type="radio"
                name="polarity"
                checked={p.polarity === v}
                onChange={() => p.setPolarity(v)}
              />
              {v === "all"
                ? "All"
                : v === "positive"
                ? "Positive (ESI+)"
                : v === "negative"
                ? "Negative (ESI-)"
                : "Dual (+ / -)"}
            </label>
          ))}
        </div>
        {p.polarity === "dual" && (
          <div className="mt-3 pt-2.5 border-t border-ink-100/80">
            <Row label="Dual Layout">
              <select
                className="input py-1 text-xs"
                value={p.dualLayout}
                onChange={(e) => p.setDualLayout(e.target.value as "stacked" | "grid")}
              >
                <option value="stacked">Stacked (Full Width)</option>
                <option value="grid">Side-by-Side (2 Columns)</option>
              </select>
            </Row>
          </div>
        )}
      </GroupBox>

      <GroupBox title="Panels">
        <Check label="Show TIC" checked={p.showTIC} onChange={p.setShowTIC} />
        <Check
          label="Show Spectrum"
          checked={p.showSpectrum}
          onChange={p.setShowSpectrum}
        />
        <Check label="Show UV" checked={p.showUV} onChange={p.setShowUV} />
      </GroupBox>

      <GroupBox title="TIC region">
        <Check
          label="Region Select (drag on TIC)"
          checked={p.regionSelect}
          onChange={p.setRegionSelect}
        />
        <Row label="Ignore m/z">
          <input
            className="input w-full"
            value={p.regionIgnoredMzText}
            onChange={(e) => p.setRegionIgnoredMzText(e.target.value)}
            placeholder="91.1, 113.0"
            spellCheck={false}
          />
        </Row>
        <Row label="± m/z">
          <input
            type="number"
            min={0.001}
            step="0.01"
            className="input w-24"
            value={p.regionIgnoredMzTolerance}
            onChange={(e) => {
              const value = parseFloat(e.target.value);
              p.setRegionIgnoredMzTolerance(Number.isFinite(value) && value > 0 ? value : 0.01);
            }}
          />
        </Row>
        <p className="text-[11px] text-ink-500">
          {p.regionIgnoredCount > 0
            ? `${p.regionIgnoredCount} mass${p.regionIgnoredCount === 1 ? "" : "es"} hidden from summed region MS1 scaling.`
            : "Hide dominant contaminants from summed region MS1 scaling."}
        </p>
        <button
          className="mt-2 rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!p.regionSelect}
          onClick={() => p.setRegionSelect(false)}
        >
          Clear Region
        </button>
      </GroupBox>

      <GroupBox title="Overlays and exports">
        <Check
          label="Overlay loaded TICs"
          checked={p.overlayTicEnabled}
          onChange={p.setOverlayTicEnabled}
        />
        <Check
          label="Overlay attached UV traces"
          checked={p.overlayUvEnabled}
          onChange={p.setOverlayUvEnabled}
        />
        <Check
          label="Overlay spectra at selected RT"
          checked={p.overlaySpectrumEnabled}
          onChange={p.setOverlaySpectrumEnabled}
        />
        <Check
          label="Overlay generated EICs"
          checked={p.overlayEicEnabled}
          onChange={p.setOverlayEicEnabled}
        />
        <div>
          <button
            type="button"
            className="w-full rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={p.overlaySessionIds.length === 0}
            onClick={() => p.setOverlaySessionIds([])}
          >
            Clear TIC/UV selection
          </button>
        </div>
        <div className="max-h-28 overflow-auto rounded-md border border-ink-200 bg-surface p-2">
          {p.sessions.map((session) => (
            <label key={session.session_id} className="flex items-center gap-2 py-0.5 text-xs">
              <input
                type="checkbox"
                checked={p.overlaySessionIds.includes(session.session_id)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  p.setOverlaySessionIds(
                    checked
                      ? [...p.overlaySessionIds, session.session_id]
                      : p.overlaySessionIds.filter((sid) => sid !== session.session_id),
                  );
                }}
              />
              <span className="truncate">{session.display_name}</span>
            </label>
          ))}
        </div>
        <div className="mt-2">
          <Check
            label="Show labels for all overlayed spectra"
            checked={p.showOverlayLabels}
            onChange={p.setShowOverlayLabels}
          />
          <Check
            label="Multi-drag labels across overlay"
            checked={p.multiDragOverlay}
            onChange={p.setMultiDragOverlay}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NavyButton onClick={p.onExportSpectrum} disabled={!p.activeLoaded}>
            Spectrum CSV
          </NavyButton>
          <NavyButton onClick={p.onExportUV} disabled={!p.activeLoaded}>
            UV CSV
          </NavyButton>
          <NavyButton onClick={p.onExportTICOverlay} disabled={!p.activeLoaded}>
            TIC overlay CSV
          </NavyButton>
          <NavyButton onClick={p.onSumRegionSpectrum} disabled={!p.activeLoaded}>
            Sum RT window
          </NavyButton>
        </div>
      </GroupBox>
    </div>
  );
}

// --- Small layout primitives -------------------------------------------------

export function GroupBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-md border border-ink-200 bg-surface p-3">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {title}
      </legend>
      <div className="flex flex-col gap-2">{children}</div>
    </fieldset>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  // Wrapping the control in the <label> associates the text with it for screen readers.
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-sm text-ink-700">{label}</span>
      {children}
    </label>
  );
}

export function Check({
  label,
  checked,
  onChange,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <label className={clsx("flex items-center gap-2 text-sm text-ink-800", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function NavyButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "rounded-md bg-[rgb(85,115,185)] px-3 py-1.5 text-xs font-medium text-white transition-colors",
        "hover:bg-ink-900",
        "disabled:cursor-not-allowed disabled:bg-ink-300 disabled:text-ink-500",
        className,
      )}
    >
      {children}
    </button>
  );
}

// --- Charts ------------------------------------------------------------------
