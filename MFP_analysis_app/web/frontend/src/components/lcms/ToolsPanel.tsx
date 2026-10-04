import { ChangeEvent, ReactNode, useState } from "react";
import Plot from "react-plotly.js";
import clsx from "clsx";
import { LCMSSessionSummary } from "../../api";
import { ExperimentTagEditor } from "../ExperimentTagEditor";
import { Hint } from "../Hint";
import { useRevealPanel } from "../../help/reveal";
import { type PolymerUiSettings } from "../../lcms/analysis";
import { ChevronLeft, ChevronRight, Columns2, PanelRightClose, PanelRightOpen, Rows2 } from "lucide-react";
import { SegmentedControl } from "../common/SegmentedControl";
import { Polarity, RtUnit, UvTimeUnit, TabId, UVLabelOrientation, formatRange } from "../../lcms/viewShared";
import { ICON_PROPS } from "../common/ChartCardParts";

export function DatasetRibbon(props: {
  active: LCMSSessionSummary | null;
  onTagUpdated?: (newTag: string) => void;
  polarity: Polarity;
  setPolarity: (p: Polarity) => void;
  dualLayout: "stacked" | "grid";
  setDualLayout: (l: "stacked" | "grid") => void;
}) {
  const a = props.active;
  const status = a
    ? [
        `${a.ms1_count} MS1 scans`,
        `RT ${formatRange(a.rt_min ?? null, a.rt_max ?? null)} min`,
        a.polarities?.length ? a.polarities.join(" / ") : null,
        a.uv?.available ? `UV: ${a.uv.filename ?? "attached"}` : "no UV",
      ]
        .filter(Boolean)
        .join(" · ")
    : "No dataset open";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {a && (
          <span className="text-card-title max-w-[28rem] truncate" title={a.display_name}>
            {a.display_name}
          </span>
        )}
        <span className="text-caption">{status}</span>
        {a && (
          <ExperimentTagEditor
            sessionId={a.session_id}
            currentTag={a.experiment_tag}
            module="lcms"
            onTagUpdated={props.onTagUpdated}
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        <Hint id="lcms.polarity" placement="bottom">
          <SegmentedControl
            size="sm"
            ariaLabel="Polarity"
            value={props.polarity}
            onChange={props.setPolarity}
            options={[
              { value: "all", label: "All" },
              { value: "positive", label: "ESI+" },
              { value: "negative", label: "ESI−" },
              { value: "dual", label: "Dual (+/−)" },
            ]}
          />
        </Hint>
        {props.polarity === "dual" && (
          <Hint id="lcms.dualLayout" placement="bottom">
            <SegmentedControl
              size="sm"
              ariaLabel="Dual layout"
              value={props.dualLayout}
              onChange={props.setDualLayout}
              options={[
                { value: "stacked", label: "Stacked", icon: <Rows2 {...ICON_PROPS} /> },
                { value: "grid", label: "2 columns", icon: <Columns2 {...ICON_PROPS} /> },
              ]}
            />
          </Hint>
        )}
      </div>
    </div>
  );
}

// --- Right: tools panel ------------------------------------------------------

export interface ToolsPanelProps {
  // primary
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
  useRevealPanel({
    "lcms.tools.analysis": () => {
      setCollapsed(false);
      p.setActiveTab("navigate");
    },
    "lcms.tools.display": () => {
      setCollapsed(false);
      p.setActiveTab("view");
    },
    "lcms.tools.polymer": () => {
      setCollapsed(false);
      p.setActiveTab("navigate");
      p.setShowPolymerControls(true);
    },
  });
  const displayTab = p.activeTab === "view";

  return (
    <aside
      aria-expanded={!collapsed}
      className={clsx(
        "flex shrink-0 flex-col border-l border-ink-200 bg-surface",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-11 overflow-hidden" : "w-[290px] overflow-y-auto overflow-x-hidden",
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center py-2">
          <Hint id="lcms.collapseTools" placement="left">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Expand tools panel"
              className="btn-ghost px-1.5"
            >
              <PanelRightOpen {...ICON_PROPS} />
            </button>
          </Hint>
        </div>
      ) : (
        <>
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-ink-200 bg-surface px-3 py-2">
            <Hint id="lcms.toolsSection" className="flex-1">
              <SegmentedControl
                size="sm"
                className="flex-1 [&>button]:flex-1"
                ariaLabel="Tools panel section"
                value={displayTab ? "view" : "navigate"}
                onChange={p.setActiveTab}
                options={[
                  { value: "navigate", label: "Analysis" },
                  { value: "view", label: "Display" },
                ]}
              />
            </Hint>
            <Hint id="lcms.collapseTools" placement="left">
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse tools panel"
                className="btn-ghost px-1.5"
              >
                <PanelRightClose {...ICON_PROPS} />
              </button>
            </Hint>
          </div>
          <div className="flex-1 p-3">{displayTab ? <DisplayTab {...p} /> : <ToolsTab {...p} />}</div>
        </>
      )}
    </aside>
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
      <GroupBox title="Scan navigation">
        <Hint id="lcms.scanNav" className="w-full">
          <div className="grid grid-cols-2 gap-2 w-full min-w-0">
            <NavyButton onClick={p.onPrev} disabled={!p.activeLoaded}>
              <ChevronLeft {...ICON_PROPS} />
              Prev
            </NavyButton>
            <NavyButton onClick={p.onNext} disabled={!p.activeLoaded}>
              Next
              <ChevronRight {...ICON_PROPS} />
            </NavyButton>
            <NavyButton onClick={p.onFirst} disabled={!p.activeLoaded}>
              First
            </NavyButton>
            <NavyButton onClick={p.onLast} disabled={!p.activeLoaded}>
              Last
            </NavyButton>
          </div>
        </Hint>
        <p className="text-caption">Tip: ← / → keys step through scans</p>
      </GroupBox>

      <GroupBox title="Chromatograms">
        <div className="grid grid-cols-2 gap-2">
          <NavyButton hint="lcms.eic" primary onClick={p.onEICDialog} disabled={!p.activeLoaded || p.busy}>
            EIC…
          </NavyButton>
          <NavyButton hint="lcms.findMz" onClick={p.onFindMz} disabled={!p.activeLoaded || p.busy}>
            Find m/z…
          </NavyButton>
        </div>
      </GroupBox>

      {/* 2. Jump to RT */}
      <GroupBox title="Jump to RT">
        <Hint id="lcms.rtJump" className="w-full">
          <div className="flex items-center gap-2 w-full min-w-0">
            <span className="text-body shrink-0">RT ({p.rtUnit === "seconds" ? "s" : "min"})</span>
            <input
              type="number"
              className="input min-w-0 flex-1"
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
        </Hint>
      </GroupBox>

      {/* 3. Spectrum Peak Labels */}
      <GroupBox title="Spectrum peak labels">
        <Check
          hint="lcms.annotateSpectrum"
          label="Annotate spectrum peaks with m/z"
          checked={p.annotateSpectrum}
          onChange={p.setAnnotateSpectrum}
        />
        <Row label="Top N" hint="lcms.labelTopN">
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
        <Row label="Min rel intensity" hint="lcms.labelMinRel">
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
          hint="lcms.dragLabels"
          label="Enable dragging labels with mouse"
          checked={p.enableDragLabels}
          onChange={p.setEnableDragLabels}
        />
      </GroupBox>

      {/* 4. Polymer & Reaction Matching */}
      {p.showPolymerControls && (
        <GroupBox title="Polymer & reaction matching">
          <Hint id="lcms.polymerEnable">
            <label
              className={clsx(
                "text-body flex items-center gap-2",
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
          </Hint>
          <p className="text-caption">{polymerStatus}</p>
          <NavyButton hint="lcms.polymerDialog" className="w-full" onClick={p.onPolymerDialog}>
            Polymer Match…
          </NavyButton>
          <Hint id="lcms.expectedProducts" className="w-full" extra={p.canOpenExpectedProducts ? undefined : "Select a polarity, set monomers and open an MS1 spectrum first."}>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={p.onExpectedProducts}
              disabled={!p.canOpenExpectedProducts}
            >
              Expected products…
            </button>
          </Hint>
          <Hint id="lcms.kendrick" className="w-full" extra={p.canOpenKendrick ? undefined : "Open an MS1 spectrum first."}>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={p.onKendrick}
              disabled={!p.canOpenKendrick}
            >
              Kendrick plot…
            </button>
          </Hint>
          <Hint id="lcms.polymerDefaults" className="w-full">
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={p.onSavePolymerDefaults}
            >
              Save current as defaults
            </button>
          </Hint>
        </GroupBox>
      )}

      <GroupBox title="Tables & exports">
        <div className="grid grid-cols-2 gap-2">
          <NavyButton hint="lcms.featureTable" onClick={p.onFeatureTable} disabled={!p.activeLoaded}>
            Feature table{p.featureCount > 0 ? ` (${p.featureCount})` : ""}
          </NavyButton>
          <NavyButton hint="lcms.comparison" onClick={p.onComparisonMatrix} disabled={!p.activeLoaded}>
            Comparison
          </NavyButton>
        </div>
        <NavyButton hint="lcms.exportLabels" onClick={p.onExportLabels} disabled={!p.activeLoaded || p.busy}>
          Export labels (all scans)…
        </NavyButton>
      </GroupBox>
    </div>
  );
}

export function DisplayTab(p: ToolsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <GroupBox title="Extra controls">
        <Check hint="lcms.showPolymerControls" label="Polymer matching" checked={p.showPolymerControls} onChange={p.setShowPolymerControls} />
        <Check label="Confidence" checked={p.showConfidenceControls} onChange={p.setShowConfidenceControls} />
        <Check label="Alignment diagnostics" checked={p.showAlignmentDiagnostics} onChange={p.setShowAlignmentDiagnostics} />
      </GroupBox>

      <GroupBox title="Filters & units">
        <Row label="RT display unit" hint="lcms.rtUnit">
          <select
            className="input"
            value={p.rtUnit}
            onChange={(e) => p.setRtUnit(e.target.value as RtUnit)}
          >
            <option value="minutes">minutes</option>
            <option value="seconds">seconds</option>
          </select>
        </Row>
        <Row label="UV CSV time unit" hint="lcms.uvTimeUnit">
          <select
            className="input"
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
        <Hint id="lcms.polarity" className="w-full">
          <div className="flex flex-wrap items-center gap-4 w-full min-w-0">
            {(["all", "positive", "negative", "dual"] as Polarity[]).map((v) => (
              <label key={v} className="text-body flex items-center gap-1.5">
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
        </Hint>
        {p.polarity === "dual" && (
          <div className="mt-3 pt-2.5 border-t border-ink-100/80">
            <Row label="Dual layout" hint="lcms.dualLayout">
              <select
                className="input py-1"
                value={p.dualLayout}
                onChange={(e) => p.setDualLayout(e.target.value as "stacked" | "grid")}
              >
                <option value="stacked">Stacked (full width)</option>
                <option value="grid">Side by side (2 columns)</option>
              </select>
            </Row>
          </div>
        )}
      </GroupBox>

      <GroupBox title="Panels">
        <Check hint="lcms.panels" label="Show TIC" checked={p.showTIC} onChange={p.setShowTIC} />
        <Check
          hint="lcms.panels"
          label="Show spectrum"
          checked={p.showSpectrum}
          onChange={p.setShowSpectrum}
        />
        <Check hint="lcms.panels" label="Show UV" checked={p.showUV} onChange={p.setShowUV} />
      </GroupBox>

      <GroupBox title="TIC region">
        <Check
          hint="lcms.regionSelect"
          label="Region select (drag on TIC)"
          checked={p.regionSelect}
          onChange={p.setRegionSelect}
        />
        <Row label="Ignore m/z" hint="lcms.ignoreMz">
          <input
            className="input w-full"
            value={p.regionIgnoredMzText}
            onChange={(e) => p.setRegionIgnoredMzText(e.target.value)}
            placeholder="91.1, 113.0"
            spellCheck={false}
          />
        </Row>
        <Row label="± m/z" hint="lcms.ignoreTol">
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
        <p className="text-caption">
          {p.regionIgnoredCount > 0
            ? `${p.regionIgnoredCount} mass${p.regionIgnoredCount === 1 ? "" : "es"} hidden from summed region MS1 scaling.`
            : "Hide dominant contaminants from summed region MS1 scaling."}
        </p>
        <Hint id="lcms.clearRegion" className="w-full">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={!p.regionSelect}
            onClick={() => p.setRegionSelect(false)}
          >
            Clear region
          </button>
        </Hint>
      </GroupBox>

      <GroupBox title="Overlays and exports">
        <Check
          hint="lcms.overlays"
          label="Overlay loaded TICs"
          checked={p.overlayTicEnabled}
          onChange={p.setOverlayTicEnabled}
        />
        <Check
          hint="lcms.overlays"
          label="Overlay attached UV traces"
          checked={p.overlayUvEnabled}
          onChange={p.setOverlayUvEnabled}
        />
        <Check
          hint="lcms.overlays"
          label="Overlay spectra at selected RT"
          checked={p.overlaySpectrumEnabled}
          onChange={p.setOverlaySpectrumEnabled}
        />
        <Check
          hint="lcms.overlays"
          label="Overlay generated EICs"
          checked={p.overlayEicEnabled}
          onChange={p.setOverlayEicEnabled}
        />
        <div>
          <Hint id="lcms.overlayFiles">
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={p.overlaySessionIds.length === 0}
              onClick={() => p.setOverlaySessionIds([])}
            >
              Clear TIC/UV selection
            </button>
          </Hint>
        </div>
        <div className="max-h-28 overflow-auto rounded-md border border-ink-200 bg-surface p-2">
          {p.sessions.map((session) => (
            <label key={session.session_id} className="flex items-center gap-2 py-0.5 text-[13px]">
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
            hint="lcms.overlayLabels"
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
        <Hint id="lcms.exportCsv" className="w-full">
          <div className="mt-2 grid grid-cols-2 gap-2 w-full min-w-0">
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
        </Hint>
      </GroupBox>
    </div>
  );
}

// --- Small layout primitives -------------------------------------------------

const SECONDARY_BUTTON =
  "btn justify-center border border-ink-200 bg-surface text-ink-800 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-40";

export function GroupBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 rounded-md border border-ink-200 bg-surface p-3">
      <legend className="text-section px-1">{title}</legend>
      <div className="flex flex-col gap-2">{children}</div>
    </fieldset>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  // Wrapping the control in the <label> associates the text with it for screen readers.
  const row = (
    <label className="flex flex-1 items-center justify-between gap-2">
      <span className="text-body text-ink-700">{label}</span>
      {children}
    </label>
  );
  return hint ? (
    <Hint id={hint} className="w-full">
      {row}
    </Hint>
  ) : (
    row
  );
}

export function Check({
  label,
  checked,
  onChange,
  className,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
  hint?: string;
}) {
  const check = (
    <label className={clsx("text-body flex items-center gap-2", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
  return hint ? <Hint id={hint}>{check}</Hint> : check;
}

// Outlined secondary button for the tools panel; `primary` makes it the one filled action of its group.
export function NavyButton({
  children,
  onClick,
  disabled,
  className,
  primary,
  hint,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  primary?: boolean;
  hint?: string;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(primary ? "btn-primary justify-center" : SECONDARY_BUTTON, hint && "w-full", className)}
    >
      {children}
    </button>
  );
  return hint ? (
    <Hint id={hint} className="w-full">
      {button}
    </Hint>
  ) : (
    button
  );
}

// --- Charts ------------------------------------------------------------------
