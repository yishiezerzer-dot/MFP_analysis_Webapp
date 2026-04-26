import {
  ChangeEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Plot from "react-plotly.js";
import type { PlotMouseEvent } from "plotly.js";
import clsx from "clsx";
import {
  api,
  LCMSSessionSummary,
  SpectrumData,
  TICData,
  UVChromatogramResponse,
} from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";

type Polarity = "all" | "positive" | "negative";
type RtUnit = "minutes" | "seconds";
type TabId = "navigate" | "view" | "annotate" | "polymer";

// --- Helpers -----------------------------------------------------------------

function nearestIndex(arr: number[], value: number): number {
  if (arr.length === 0) return -1;
  let best = 0;
  let bestDiff = Math.abs(arr[0] - value);
  for (let i = 1; i < arr.length; i += 1) {
    const d = Math.abs(arr[i] - value);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

function formatRange(a: number | null, b: number | null): string {
  if (a == null || b == null) return "—";
  return `${a.toFixed(2)} – ${b.toFixed(2)}`;
}

function toCSV(rows: string[][]): string {
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

// --- Main view ---------------------------------------------------------------

export function LCMSView() {
  // Sessions / data
  const [sessions, setSessions] = useState<LCMSSessionSummary[]>([]);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [tic, setTic] = useState<TICData | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumData | null>(null);
  const [uv, setUv] = useState<UVChromatogramResponse | null>(null);

  // Filters / display
  const [polarity, setPolarity] = useState<Polarity>("all");
  const [rtUnit, setRtUnit] = useState<RtUnit>("minutes");

  // Right sidebar state
  const [activeTab, setActiveTab] = useState<TabId>("navigate");
  const [workflowHidden, setWorkflowHidden] = useState(false);
  const [showPolymerControls, setShowPolymerControls] = useState(false);
  const [showConfidenceControls, setShowConfidenceControls] = useState(false);
  const [showAlignmentDiagnostics, setShowAlignmentDiagnostics] = useState(false);

  // Panel visibility
  const [showTIC, setShowTIC] = useState(true);
  const [showSpectrum, setShowSpectrum] = useState(true);
  const [showUV, setShowUV] = useState(true);

  // UV↔MS alignment
  const [uvOffsetText, setUvOffsetText] = useState("0.000");
  const [uvOffset, setUvOffset] = useState(0);
  const [autoAlignUv, setAutoAlignUv] = useState(false);

  // Annotate – spectrum
  const [annotateSpectrum, setAnnotateSpectrum] = useState(true);
  const [spectrumTopN, setSpectrumTopN] = useState(10);
  const [spectrumMinRel, setSpectrumMinRel] = useState(0.05);
  const [enableDragLabels, setEnableDragLabels] = useState(true);

  // Annotate – UV
  const [transferMsToUv, setTransferMsToUv] = useState(false);
  const [uvTransferCount, setUvTransferCount] = useState(3);
  const [uvProminence, setUvProminence] = useState(0.05);
  const [uvMinDistance, setUvMinDistance] = useState(0.2);
  const [showConfidenceUV, setShowConfidenceUV] = useState(false);

  // Annotate – overlay
  const [showOverlayLabels, setShowOverlayLabels] = useState(false);
  const [multiDragOverlay, setMultiDragOverlay] = useState(false);

  // View – region select
  const [regionSelect, setRegionSelect] = useState(false);

  // RT navigation
  const [selectedRt, setSelectedRt] = useState<number | null>(null);
  const [rtJumpText, setRtJumpText] = useState("");

  // IO state
  const [busy, setBusy] = useState(false);
  const [uvBusy, setUvBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Dialog / modal state
  const [findMzOpen, setFindMzOpen] = useState(false);
  const [eicOpen, setEicOpen] = useState(false);
  const [graphSettingsOpen, setGraphSettingsOpen] = useState(false);
  const [polymerDialogOpen, setPolymerDialogOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const uvFileRef = useRef<HTMLInputElement>(null);

  const active = useMemo(
    () => sessions.find((s) => s.session_id === activeSid) ?? null,
    [sessions, activeSid],
  );

  const pol = polarity === "all" ? undefined : polarity;

  // --- data loading ---------------------------------------------------------

  useEffect(() => {
    api.lcms
      .list()
      .then((list) => {
        setSessions(list);
        if (list.length && !activeSid) setActiveSid(list[0].session_id);
      })
      .catch((err) => setError(String(err)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeSid) {
      setTic(null);
      return;
    }
    api.lcms
      .tic(activeSid, pol)
      .then(setTic)
      .catch((err) => setError(String(err)));
  }, [activeSid, pol]);

  useEffect(() => {
    if (!activeSid) {
      setUv(null);
      return;
    }
    api.lcms
      .uv(activeSid, {
        top_n: uvTransferCount > 0 ? Math.max(1, uvTransferCount) * 3 : 8,
        min_rel: uvProminence,
        min_distance_min: uvMinDistance,
      })
      .then(setUv)
      .catch((err) => setError(String(err)));
  }, [activeSid, uvProminence, uvMinDistance, uvTransferCount]);

  // --- callbacks ------------------------------------------------------------

  const loadSpectrum = useCallback(
    (rtMin: number) => {
      if (!activeSid) return;
      setBusy(true);
      setSelectedRt(rtMin);
      api.lcms
        .spectrum(activeSid, {
          rt_min: rtMin,
          polarity: pol,
          top_n: Math.max(1, spectrumTopN),
          min_rel: Math.max(0, spectrumMinRel),
        })
        .then(setSpectrum)
        .catch((err) => setError(String(err)))
        .finally(() => setBusy(false));
    },
    [activeSid, pol, spectrumTopN, spectrumMinRel],
  );

  const onUpload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.lcms.upload(file);
      setSessions((prev) => [...prev, s]);
      setActiveSid(s.session_id);
      setSpectrum(null);
      setSelectedRt(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (sid: string) => {
    await api.lcms.remove(sid).catch((err) => setError(String(err)));
    setSessions((prev) => prev.filter((s) => s.session_id !== sid));
    if (activeSid === sid) {
      setActiveSid(null);
      setSpectrum(null);
      setTic(null);
      setSelectedRt(null);
    }
  };

  const onUploadUV = async (file: File) => {
    if (!activeSid) return;
    setUvBusy(true);
    setError(null);
    try {
      const summary = await api.lcms.uploadUV(activeSid, file);
      setSessions((prev) =>
        prev.map((s) => (s.session_id === summary.session_id ? summary : s)),
      );
      const data = await api.lcms.uv(activeSid, {
        top_n: 8,
        min_rel: uvProminence,
        min_distance_min: uvMinDistance,
      });
      setUv(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setUvBusy(false);
    }
  };

  const onRemoveUV = async () => {
    if (!activeSid) return;
    setUvBusy(true);
    try {
      await api.lcms.removeUV(activeSid);
      setUv({
        available: false,
        reason: "No UV chromatogram attached to this dataset.",
      });
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === activeSid ? { ...s, uv: { available: false } } : s,
        ),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setUvBusy(false);
    }
  };

  // Navigation helpers
  const rtList = tic?.rt_min ?? [];

  const goToIndex = (i: number) => {
    if (i < 0 || i >= rtList.length) return;
    loadSpectrum(rtList[i]);
  };
  const goFirst = () => goToIndex(0);
  const goLast = () => goToIndex(rtList.length - 1);
  const goPrev = () => {
    if (rtList.length === 0) return;
    if (selectedRt == null) return goLast();
    const i = nearestIndex(rtList, selectedRt);
    goToIndex(Math.max(0, i - 1));
  };
  const goNext = () => {
    if (rtList.length === 0) return;
    if (selectedRt == null) return goFirst();
    const i = nearestIndex(rtList, selectedRt);
    goToIndex(Math.min(rtList.length - 1, i + 1));
  };
  const goJump = () => {
    const t = parseFloat(rtJumpText);
    if (!Number.isFinite(t) || rtList.length === 0) return;
    const rtMin = rtUnit === "seconds" ? t / 60.0 : t;
    const i = nearestIndex(rtList, rtMin);
    goToIndex(i);
  };

  // Find m/z: scan every MS1 at current filter for the most intense near m/z
  const [findMzInput, setFindMzInput] = useState("");
  const [findMzTol, setFindMzTol] = useState(0.01);
  const findMz = async () => {
    if (!activeSid) return;
    const target = parseFloat(findMzInput);
    if (!Number.isFinite(target)) return;
    setBusy(true);
    setError(null);
    try {
      // Crude but works: sweep every MS1 and ask backend for spectrum; pick the one
      // with highest intensity in [target-tol, target+tol]. For large files this is
      // slow, so we first downsample the RT grid to at most 200 probes.
      const probes: number[] = [];
      const n = rtList.length;
      if (n === 0) return;
      const stride = Math.max(1, Math.floor(n / 200));
      for (let i = 0; i < n; i += stride) probes.push(rtList[i]);

      let bestRt = probes[0];
      let bestIntensity = -1;
      for (const rt of probes) {
        const sp = await api.lcms.spectrum(activeSid, {
          rt_min: rt,
          polarity: pol,
          top_n: 5,
          min_rel: 0.0,
        });
        for (let i = 0; i < sp.mz.length; i += 1) {
          if (Math.abs(sp.mz[i] - target) <= findMzTol) {
            if (sp.intensity[i] > bestIntensity) {
              bestIntensity = sp.intensity[i];
              bestRt = rt;
            }
            break;
          }
        }
      }
      setFindMzOpen(false);
      loadSpectrum(bestRt);
      setInfo(
        `Strongest match for m/z ${target.toFixed(4)} ± ${findMzTol.toFixed(3)}: RT ${bestRt.toFixed(3)} min`,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // Auto-align UV↔MS: peak-correlation between UV signal and TIC
  const autoAlignNow = () => {
    if (!tic || !uv || !uv.available) {
      setInfo(
        "Auto-align needs both a loaded MS and an attached UV chromatogram.",
      );
      return;
    }
    const maxLagMin = 1.0;
    const tRt = tic.rt_min;
    const tY = tic.tic;
    const uRt = (uv as Extract<UVChromatogramResponse, { available: true }>).rt_min;
    const uY = (uv as Extract<UVChromatogramResponse, { available: true }>).signal;
    if (tRt.length < 10 || uRt.length < 10) return;
    // Normalize
    const norm = (a: number[]) => {
      const mx = Math.max(...a);
      return mx > 0 ? a.map((v) => v / mx) : a;
    };
    const tN = norm(tY);
    // Resample UV onto TIC grid by nearest-neighbour
    const resampled = tRt.map((t) => {
      const i = nearestIndex(uRt, t);
      return i >= 0 ? uY[i] : 0;
    });
    const uN = norm(resampled);
    // Scan offsets in minutes on tRt step
    const step = tRt.length > 1 ? Math.abs(tRt[1] - tRt[0]) : 0.01;
    const maxLag = Math.max(1, Math.round(maxLagMin / Math.max(step, 1e-6)));
    let bestScore = -Infinity;
    let bestLag = 0;
    for (let lag = -maxLag; lag <= maxLag; lag += 1) {
      let s = 0;
      for (let i = 0; i < tN.length; i += 1) {
        const j = i + lag;
        if (j >= 0 && j < uN.length) s += tN[i] * uN[j];
      }
      if (s > bestScore) {
        bestScore = s;
        bestLag = lag;
      }
    }
    const offset = bestLag * step;
    setUvOffset(offset);
    setUvOffsetText(offset.toFixed(3));
    setInfo(`Auto-aligned UV to MS: offset ${offset.toFixed(3)} min`);
  };

  useEffect(() => {
    if (autoAlignUv) autoAlignNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAlignUv, tic, uv]);

  // Export labels: CSV of top-N m/z per MS1 scan at current filter
  const exportLabels = async () => {
    if (!activeSid || rtList.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const rows: string[][] = [["rt_min", "mz", "intensity"]];
      const stride = Math.max(1, Math.floor(rtList.length / 300));
      for (let i = 0; i < rtList.length; i += stride) {
        const rt = rtList[i];
        const sp = await api.lcms.spectrum(activeSid, {
          rt_min: rt,
          polarity: pol,
          top_n: Math.max(1, spectrumTopN),
          min_rel: spectrumMinRel,
        });
        for (const lbl of sp.labels) {
          rows.push([
            rt.toFixed(4),
            lbl.mz.toFixed(4),
            lbl.intensity.toExponential(3),
          ]);
        }
      }
      const blob = new Blob([toCSV(rows)], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${active?.display_name ?? "lcms"}.labels.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setInfo(`Exported ${rows.length - 1} labels across ${rtList.length} scans.`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onTICClick = (ev: Readonly<PlotMouseEvent>) => {
    const p = ev.points?.[0];
    if (p && typeof p.x === "number") loadSpectrum(p.x);
  };

  // --- header ---------------------------------------------------------------

  usePageHeader(
    <PageHeaderContent
      title="LCMS"
      subtitle="mzML viewer — TIC, UV, spectrum at click, top-peak annotation"
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".mzML,.mzml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Working…" : "Open mzML…"}
          </button>
        </>
      }
    />,
  );

  const statusText = useMemo(() => {
    return {
      mzml: active?.display_name ?? "(no mzML)",
      uv:
        active?.uv?.available && active.uv.filename
          ? active.uv.filename
          : "(no UV linked)",
      polarity,
      offset: uvOffset,
    };
  }, [active, polarity, uvOffset]);

  // --- render ---------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
          {error}{" "}
          <button className="underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}
      {info && (
        <div className="border-b border-brand-200 bg-brand-50 px-6 py-2 text-sm text-brand-700">
          {info}{" "}
          <button className="underline" onClick={() => setInfo(null)}>
            dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <SessionsSidebar
          sessions={sessions}
          activeSid={activeSid}
          onSelect={setActiveSid}
          onRemove={onRemove}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6">
          <DatasetRibbon active={active} />

          {!active && <EmptyState onPick={() => fileRef.current?.click()} />}

          {active && (
            <>
              {showTIC && (
                <TICChart
                  tic={tic}
                  onClick={onTICClick}
                  selectedRt={selectedRt}
                  rtUnit={rtUnit}
                  regionSelect={regionSelect}
                />
              )}
              {showUV && (
                <UVChromatogramChart
                  uv={uv}
                  busy={uvBusy}
                  xOffset={uvOffset}
                  rtUnit={rtUnit}
                  onPickFile={() => uvFileRef.current?.click()}
                  onRemove={onRemoveUV}
                />
              )}
              {showSpectrum && (
                <SpectrumChart
                  spectrum={spectrum}
                  annotate={annotateSpectrum}
                  showDragHint={enableDragLabels}
                />
              )}
            </>
          )}

          <input
            ref={uvFileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadUV(f);
              e.target.value = "";
            }}
          />
        </div>

        <ToolsPanel
          // Primary actions
          onEIC={() => setEicOpen(true)}
          onJumpMz={() => setFindMzOpen(true)}
          onExportLabels={exportLabels}
          busy={busy}
          activeLoaded={!!active}
          // Workflow chrome
          workflowHidden={workflowHidden}
          setWorkflowHidden={setWorkflowHidden}
          showPolymerControls={showPolymerControls}
          setShowPolymerControls={setShowPolymerControls}
          showConfidenceControls={showConfidenceControls}
          setShowConfidenceControls={setShowConfidenceControls}
          showAlignmentDiagnostics={showAlignmentDiagnostics}
          setShowAlignmentDiagnostics={setShowAlignmentDiagnostics}
          // Tabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          // Navigate
          onPrev={goPrev}
          onNext={goNext}
          onFirst={goFirst}
          onLast={goLast}
          onFindMz={() => setFindMzOpen(true)}
          onAutoAlignUV={autoAlignNow}
          onEICDialog={() => setEicOpen(true)}
          rtJumpText={rtJumpText}
          setRtJumpText={setRtJumpText}
          onRtJump={goJump}
          rtUnit={rtUnit}
          // View
          polarity={polarity}
          setPolarity={setPolarity}
          setRtUnit={setRtUnit}
          uvOffsetText={uvOffsetText}
          setUvOffsetText={setUvOffsetText}
          onApplyOffset={() => {
            const v = parseFloat(uvOffsetText);
            setUvOffset(Number.isFinite(v) ? v : 0);
          }}
          autoAlignUv={autoAlignUv}
          setAutoAlignUv={setAutoAlignUv}
          onGraphSettings={() => setGraphSettingsOpen(true)}
          showTIC={showTIC}
          setShowTIC={setShowTIC}
          showSpectrum={showSpectrum}
          setShowSpectrum={setShowSpectrum}
          showUV={showUV}
          setShowUV={setShowUV}
          regionSelect={regionSelect}
          setRegionSelect={setRegionSelect}
          // Annotate – spectrum
          annotateSpectrum={annotateSpectrum}
          setAnnotateSpectrum={setAnnotateSpectrum}
          spectrumTopN={spectrumTopN}
          setSpectrumTopN={setSpectrumTopN}
          spectrumMinRel={spectrumMinRel}
          setSpectrumMinRel={setSpectrumMinRel}
          enableDragLabels={enableDragLabels}
          setEnableDragLabels={setEnableDragLabels}
          // Annotate – UV
          transferMsToUv={transferMsToUv}
          setTransferMsToUv={setTransferMsToUv}
          uvTransferCount={uvTransferCount}
          setUvTransferCount={setUvTransferCount}
          uvProminence={uvProminence}
          setUvProminence={setUvProminence}
          uvMinDistance={uvMinDistance}
          setUvMinDistance={setUvMinDistance}
          showConfidenceUV={showConfidenceUV}
          setShowConfidenceUV={setShowConfidenceUV}
          onLabelSelectedRT={() => {
            if (selectedRt == null) {
              setInfo("Click a point on the TIC to select an RT first.");
              return;
            }
            loadSpectrum(selectedRt);
          }}
          onAutoLabelUV={() => {
            if (activeSid)
              api.lcms
                .uv(activeSid, {
                  top_n: uvTransferCount > 0 ? uvTransferCount : 8,
                  min_rel: uvProminence,
                  min_distance_min: uvMinDistance,
                })
                .then(setUv)
                .catch((err) => setError(String(err)));
          }}
          // Annotate – overlay
          showOverlayLabels={showOverlayLabels}
          setShowOverlayLabels={setShowOverlayLabels}
          multiDragOverlay={multiDragOverlay}
          setMultiDragOverlay={setMultiDragOverlay}
          // Polymer
          onPolymerDialog={() => setPolymerDialogOpen(true)}
        />
      </div>

      <StatusBar {...statusText} />

      {findMzOpen && (
        <FindMzDialog
          input={findMzInput}
          setInput={setFindMzInput}
          tol={findMzTol}
          setTol={setFindMzTol}
          busy={busy}
          onClose={() => setFindMzOpen(false)}
          onRun={findMz}
        />
      )}
      {eicOpen && <EICDialog onClose={() => setEicOpen(false)} />}
      {graphSettingsOpen && (
        <GraphSettingsDialog onClose={() => setGraphSettingsOpen(false)} />
      )}
      {polymerDialogOpen && (
        <PolymerDialog onClose={() => setPolymerDialogOpen(false)} />
      )}
    </div>
  );
}

// --- Left: sessions list -----------------------------------------------------

const SESSIONS_PIN_STORAGE_KEY = "mfp.lcms.sessions.pinned";

function SessionsSidebar(props: {
  sessions: LCMSSessionSummary[];
  activeSid: string | null;
  onSelect: (sid: string) => void;
  onRemove: (sid: string) => void;
}) {
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(SESSIONS_PIN_STORAGE_KEY);
    return stored === "1";
  });
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SESSIONS_PIN_STORAGE_KEY,
        pinned ? "1" : "0",
      );
    } catch {
      /* ignore (private mode / SSR) */
    }
  }, [pinned]);

  const expanded = pinned || hovered;

  // Debounce mouse-leave slightly so flicking across a scrollbar or
  // trailing-edge padding doesn't collapse the panel mid-click.
  const onEnter = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHovered(true);
  };
  const onLeave = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovered(false), 120);
  };
  useEffect(() => () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
  }, []);

  return (
    <aside
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-expanded={expanded}
      className={clsx(
        "flex shrink-0 flex-col overflow-hidden border-r border-ink-200 bg-ink-50/50",
        "transition-[width] duration-200 ease-out",
        expanded ? "w-60" : "w-12",
      )}
    >
      <header
        className={clsx(
          "flex shrink-0 items-center gap-2 border-b border-ink-200/60 py-2",
          expanded ? "px-3" : "justify-center px-0",
        )}
      >
        {expanded ? (
          <>
            <span className="label flex-1 truncate">Sessions</span>
            <button
              type="button"
              onClick={() => setPinned((p) => !p)}
              title={
                pinned
                  ? "Unpin sessions panel (collapse when not hovered)"
                  : "Pin sessions panel (always open)"
              }
              aria-label={pinned ? "Unpin sessions panel" : "Pin sessions panel"}
              aria-pressed={pinned}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-200/60 hover:text-ink-800"
            >
              <IconPin pinned={pinned} className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          // Collapsed affordance: a stack icon that hints the panel holds a list
          // of items. Hovering the whole aside already expands it, so this is
          // purely a visual cue.
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500"
            title="Sessions (hover to expand, click to pin)"
            aria-hidden="true"
          >
            <IconStack className="h-4 w-4" />
          </div>
        )}
      </header>

      <div
        className={clsx(
          "flex flex-1 flex-col overflow-auto",
          expanded ? "gap-1 p-2" : "items-center gap-1 py-2",
        )}
      >
        {expanded && props.sessions.length === 0 && (
          <div className="px-2 text-xs text-ink-500">No files loaded.</div>
        )}

        {props.sessions.map((s, idx) => {
          const isActive = s.session_id === props.activeSid;
          if (!expanded) {
            // Compact rail: small active-aware chip per session.
            return (
              <button
                key={s.session_id}
                type="button"
                onClick={() => props.onSelect(s.session_id)}
                title={s.display_name}
                className={clsx(
                  "flex h-7 w-8 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold transition-colors",
                  isActive
                    ? "border-brand-500 bg-white text-brand-600 shadow-card"
                    : "border-transparent text-ink-500 hover:border-ink-200 hover:bg-white",
                )}
              >
                {idx + 1}
              </button>
            );
          }
          return (
            <div
              key={s.session_id}
              className={clsx(
                "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                isActive ? "bg-white shadow-card" : "hover:bg-ink-100",
              )}
              onClick={() => props.onSelect(s.session_id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.display_name}</div>
                <div className="text-[11px] text-ink-500">
                  {s.ms1_count} MS1 • {formatRange(s.rt_min, s.rt_max)} min
                  {s.uv?.available && " • UV"}
                </div>
              </div>
              <button
                className="invisible rounded px-1 text-xs text-ink-500 hover:bg-ink-200 hover:text-ink-900 group-hover:visible"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onRemove(s.session_id);
                }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function IconStack({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function IconPin({
  pinned,
  className,
}: {
  pinned: boolean;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
  if (pinned) {
    return (
      <svg {...common}>
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
    <svg {...common}>
      <path d="M12 17v5" />
      <path d="M15 9.34V7a1 1 0 0 1 1 -1a2 2 0 0 0 0 -4H7.89" />
      <path d="M9 9v1.76a2 2 0 0 1 -1.11 1.79l-1.78 .9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h9" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// --- Centre: dataset ribbon --------------------------------------------------

function DatasetRibbon(props: { active: LCMSSessionSummary | null }) {
  const a = props.active;
  return (
    <div className="card flex flex-wrap items-center gap-6 px-4 py-3">
      <Field label="Dataset" value={a?.display_name ?? "—"} strong />
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
  );
}

function Field({
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

interface ToolsPanelProps {
  // primary
  onEIC: () => void;
  onJumpMz: () => void;
  onExportLabels: () => void;
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
  setRtUnit: (u: RtUnit) => void;
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
  showConfidenceUV: boolean;
  setShowConfidenceUV: (v: boolean) => void;
  onLabelSelectedRT: () => void;
  onAutoLabelUV: () => void;
  // annotate – overlay
  showOverlayLabels: boolean;
  setShowOverlayLabels: (v: boolean) => void;
  multiDragOverlay: boolean;
  setMultiDragOverlay: (v: boolean) => void;
  // polymer
  onPolymerDialog: () => void;
}

function ToolsPanel(p: ToolsPanelProps) {
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
            {p.activeTab === "navigate" && <NavigateTab {...p} />}
            {p.activeTab === "view" && <ViewTab {...p} />}
            {p.activeTab === "annotate" && <AnnotateTab {...p} />}
            {p.activeTab === "polymer" && (
              <PolymerTab onOpen={p.onPolymerDialog} />
            )}
          </WorkflowTools>
        </>
      )}
    </aside>
  );
}

function PrimaryActions({
  onEIC,
  onJumpMz,
  onExportLabels,
  busy,
  activeLoaded,
  onCollapse,
}: {
  onEIC: () => void;
  onJumpMz: () => void;
  onExportLabels: () => void;
  busy: boolean;
  activeLoaded: boolean;
  onCollapse?: () => void;
}) {
  return (
    <section className="border-b border-ink-200 bg-white p-4">
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
            className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={!activeLoaded || busy}
            onClick={onJumpMz}
          >
            Jump to m/z…
          </button>
          <button
            className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
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

function WorkflowTools({
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
      <header className="flex items-start justify-between gap-2 bg-white p-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Workflow &amp; Tools</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Fine-tune visibility and advanced LCMS controls
          </p>
        </div>
        <button
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-dashed border-ink-300 bg-white px-2 text-xs text-ink-700 hover:bg-ink-100"
          onClick={() => setHidden(!hidden)}
        >
          {hidden ? "Show ▼" : "Hide ▲"}
        </button>
      </header>

      {!hidden && (
        <>
          <div className="flex flex-col gap-1 bg-white/70 px-4 pb-2">
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

          <div className="flex items-center gap-1 border-b border-ink-200 bg-white/70 px-3 pt-2">
            {(
              [
                { id: "navigate", label: "Navigate" },
                { id: "view", label: "View" },
                { id: "annotate", label: "Annotate" },
                ...(showPolymerControls
                  ? [{ id: "polymer" as const, label: "Polymer" }]
                  : []),
              ] as { id: TabId; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={clsx(
                  "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === t.id
                    ? "border-brand-500 text-ink-900"
                    : "border-transparent text-ink-500 hover:text-ink-800",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 p-4">{children}</div>
        </>
      )}
    </section>
  );
}

// --- Tabs --------------------------------------------------------------------

function NavigateTab(p: ToolsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <GroupBox title="Spectrum">
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
        <NavyButton className="mt-2 w-full" onClick={p.onFindMz} disabled={!p.activeLoaded}>
          Find m/z…
        </NavyButton>
        <NavyButton className="mt-2 w-full" onClick={p.onAutoAlignUV} disabled={!p.activeLoaded}>
          Auto-align UV↔MS
        </NavyButton>
        <NavyButton className="mt-2 w-full" onClick={p.onEICDialog} disabled={!p.activeLoaded}>
          EIC…
        </NavyButton>
      </GroupBox>

      <GroupBox title="Jump">
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-700">
            RT ({p.rtUnit === "seconds" ? "s" : "min"}):
          </label>
          <input
            type="number"
            className="input flex-1"
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
    </div>
  );
}

function ViewTab(p: ToolsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <GroupBox title="Filters">
        <Row label="RT unit">
          <select
            className="input"
            value={p.rtUnit}
            onChange={(e) => p.setRtUnit(e.target.value as RtUnit)}
          >
            <option value="minutes">minutes</option>
            <option value="seconds">seconds</option>
          </select>
        </Row>
      </GroupBox>

      <GroupBox title="Polarity">
        <div className="flex items-center gap-4">
          {(["all", "positive", "negative"] as Polarity[]).map((v) => (
            <label key={v} className="flex items-center gap-1.5 text-sm capitalize">
              <input
                type="radio"
                name="polarity"
                checked={p.polarity === v}
                onChange={() => p.setPolarity(v)}
              />
              {v === "all" ? "All" : v.charAt(0).toUpperCase() + v.slice(1)}
            </label>
          ))}
        </div>
      </GroupBox>

      <GroupBox title="UV↔MS alignment">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <div className="label">Offset (min)</div>
            <input
              type="number"
              step="0.001"
              className="input mt-1 w-full"
              value={p.uvOffsetText}
              onChange={(e) => p.setUvOffsetText(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={p.onApplyOffset}>
            Apply
          </button>
        </div>
        <Check
          className="mt-2"
          label="Enable auto-align"
          checked={p.autoAlignUv}
          onChange={p.setAutoAlignUv}
        />
      </GroupBox>

      <NavyButton className="w-full" onClick={p.onGraphSettings}>
        Graph Settings…
      </NavyButton>

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
        <button
          className="mt-2 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!p.regionSelect}
          onClick={() => p.setRegionSelect(false)}
        >
          Clear Region
        </button>
      </GroupBox>
    </div>
  );
}

function AnnotateTab(p: ToolsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <GroupBox title="Spectrum labels">
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

      <GroupBox title="UV labels">
        <Check
          label="Transfer top MS peaks to UV labels at selected RT"
          checked={p.transferMsToUv}
          onChange={p.setTransferMsToUv}
        />
        <Row label="How many peaks">
          <select
            className="input w-24"
            value={p.uvTransferCount}
            onChange={(e) => p.setUvTransferCount(parseInt(e.target.value, 10))}
          >
            {[1, 2, 3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Auto UV prominence">
          <input
            type="number"
            step="0.01"
            min={0}
            className="input w-24"
            value={p.uvProminence}
            onChange={(e) =>
              p.setUvProminence(Math.max(0, parseFloat(e.target.value || "0") || 0))
            }
          />
        </Row>
        <Row label="Auto UV min distance (min)">
          <input
            type="number"
            step="0.05"
            min={0}
            className="input w-24"
            value={p.uvMinDistance}
            onChange={(e) =>
              p.setUvMinDistance(Math.max(0, parseFloat(e.target.value || "0") || 0))
            }
          />
        </Row>
        <Check
          label="Show confidence % in UV labels"
          checked={p.showConfidenceUV}
          onChange={p.setShowConfidenceUV}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!p.transferMsToUv}
            onClick={p.onLabelSelectedRT}
          >
            Label selected RT
          </button>
          <button
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
            onClick={p.onAutoLabelUV}
          >
            Auto Label UV Peaks
          </button>
        </div>
      </GroupBox>

      <div className="grid grid-cols-3 gap-2">
        <button
          className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled
          title="Coming soon"
        >
          Annotate Peaks…
        </button>
        <button
          className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
          onClick={() => {
            /* visual-only helper for now */
          }}
        >
          Auto Arrange Labels
        </button>
        <button
          className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled
          title="Coming soon"
        >
          Custom Labels…
        </button>
      </div>

      <GroupBox title="Overlay labels">
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
      </GroupBox>
    </div>
  );
}

function PolymerTab({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <GroupBox title="Polymer matching">
        <Check
          label="Enable polymer/reaction matching"
          checked={false}
          onChange={() => onOpen()}
        />
        <p className="mt-1 text-xs text-ink-500">
          Use <span className="font-medium">Polymer Match…</span> for full settings
        </p>
        <NavyButton className="mt-2 w-full" onClick={onOpen}>
          Polymer Match…
        </NavyButton>
      </GroupBox>
    </div>
  );
}

// --- Small layout primitives -------------------------------------------------

function GroupBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-md border border-ink-200 bg-white p-3">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {title}
      </legend>
      <div className="flex flex-col gap-2">{children}</div>
    </fieldset>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-sm text-ink-700">{label}</label>
      {children}
    </div>
  );
}

function Check({
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

function NavyButton({
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

function TICChart(props: {
  tic: TICData | null;
  onClick: (e: Readonly<PlotMouseEvent>) => void;
  selectedRt: number | null;
  rtUnit: RtUnit;
  regionSelect: boolean;
}) {
  const scale = props.rtUnit === "seconds" ? 60 : 1;
  const unit = props.rtUnit === "seconds" ? "s" : "min";
  const xs = useMemo(
    () => (props.tic ? props.tic.rt_min.map((v) => v * scale) : []),
    [props.tic, scale],
  );
  const shapes =
    props.selectedRt != null
      ? [
          {
            type: "line" as const,
            xref: "x" as const,
            yref: "paper" as const,
            x0: props.selectedRt * scale,
            x1: props.selectedRt * scale,
            y0: 0,
            y1: 1,
            line: { color: "#5573b9", width: 1, dash: "dot" as const },
          },
        ]
      : [];
  return (
    <div className="card p-3">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h3 className="text-sm font-semibold">Total Ion Chromatogram</h3>
        <div className="text-xs text-ink-500">
          {props.regionSelect
            ? "Drag on the plot to select an RT region"
            : "Click a point to load the spectrum at that RT"}
        </div>
      </div>
      {!props.tic ? (
        <div className="flex h-72 items-center justify-center text-sm text-ink-500">
          Loading TIC…
        </div>
      ) : (
        <Plot
          data={[
            {
              type: "scattergl",
              mode: "lines",
              x: xs,
              y: props.tic.tic,
              line: { color: "#1e2636", width: 1.5 },
              hovertemplate: `RT: %{x:.3f} ${unit}<br>TIC: %{y:.3e}<extra></extra>`,
              name: "TIC",
            },
          ]}
          layout={{
            height: 320,
            margin: { l: 60, r: 20, t: 10, b: 40 },
            xaxis: { title: { text: `RT (${unit})` }, zeroline: false },
            yaxis: { title: { text: "TIC" }, zeroline: false, exponentformat: "e" },
            hovermode: "x",
            plot_bgcolor: "#ffffff",
            paper_bgcolor: "#ffffff",
            showlegend: false,
            shapes,
            dragmode: props.regionSelect ? "select" : "zoom",
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: "100%" }}
          useResizeHandler
          onClick={props.onClick}
        />
      )}
    </div>
  );
}

function UVChromatogramChart(props: {
  uv: UVChromatogramResponse | null;
  busy: boolean;
  xOffset: number;
  rtUnit: RtUnit;
  onPickFile: () => void;
  onRemove: () => void;
}) {
  const { uv, busy, xOffset, rtUnit, onPickFile, onRemove } = props;
  const available = uv?.available === true;
  const meta = available ? uv.meta : null;
  const scale = rtUnit === "seconds" ? 60 : 1;
  const unit = rtUnit === "seconds" ? "s" : "min";

  const xs = available ? uv.rt_min.map((v) => (v + xOffset) * scale) : [];

  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pb-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold">UV Chromatogram</h3>
          {available && meta?.filename && (
            <span className="truncate text-xs text-ink-500" title={meta.filename}>
              {meta.filename}
              {meta.y_col ? ` · ${meta.y_col}` : ""}
              {xOffset !== 0 ? ` · offset ${xOffset.toFixed(3)} min` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {available && uv.peaks.length > 0 && (
            <span className="text-ink-500">
              {uv.peaks.length} peak{uv.peaks.length === 1 ? "" : "s"} annotated
            </span>
          )}
          <button
            className="rounded-md border border-ink-200 bg-white px-2 py-1 text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onPickFile}
            disabled={busy}
            title="Attach a UV/DAD chromatogram exported from your LC"
          >
            {busy ? "Working…" : available ? "Replace UV CSV…" : "Attach UV CSV…"}
          </button>
          {available && (
            <button
              className="rounded-md border border-ink-200 bg-white px-2 py-1 text-ink-500 transition-colors hover:bg-red-50 hover:text-red-600"
              onClick={onRemove}
              disabled={busy}
              title="Detach UV chromatogram"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {!uv ? (
        <div className="flex h-72 items-center justify-center text-sm text-ink-500">
          Loading UV…
        </div>
      ) : !available ? (
        <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-ink-200 bg-ink-50/40 px-6 text-center">
          <div className="text-sm font-medium text-ink-700">
            No UV chromatogram attached
          </div>
          <div className="max-w-md text-xs text-ink-500">
            Most mzML files only contain MS scans. Export the UV/DAD trace from
            your LC software as CSV (time + signal columns) and attach it here
            to view it alongside the TIC.
          </div>
          <button className="btn-primary mt-1" onClick={onPickFile} disabled={busy}>
            Attach UV CSV…
          </button>
        </div>
      ) : (
        <>
          <Plot
            data={[
              {
                type: "scattergl",
                mode: "lines",
                x: xs,
                y: uv.signal,
                line: { color: "#5573b9", width: 1.5 },
                hovertemplate: `RT: %{x:.3f} ${unit}<br>Signal: %{y:.3e}<extra></extra>`,
                name: "UV",
              },
            ]}
            layout={{
              height: 280,
              margin: { l: 60, r: 20, t: 10, b: 40 },
              xaxis: { title: { text: `RT (${unit})` }, zeroline: false },
              yaxis: {
                title: { text: meta?.y_col || "Signal (AU)" },
                zeroline: false,
                exponentformat: "e",
              },
              annotations: uv.peaks.map((pk) => ({
                x: (pk.rt_min + xOffset) * scale,
                y: pk.signal,
                text: `${pk.rt_min.toFixed(2)}`,
                showarrow: true,
                arrowhead: 0,
                arrowcolor: "#5573b9",
                arrowwidth: 0.8,
                ax: 0,
                ay: -18,
                font: { size: 10, color: "#46536a" },
              })),
              hovermode: "x",
              plot_bgcolor: "#ffffff",
              paper_bgcolor: "#ffffff",
              showlegend: false,
            }}
            config={{ responsive: true, displaylogo: false }}
            style={{ width: "100%" }}
            useResizeHandler
          />
          {meta?.warnings && meta.warnings.length > 0 && (
            <div className="mt-1 px-1 text-[11px] text-amber-700">
              {meta.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SpectrumChart(props: {
  spectrum: SpectrumData | null;
  annotate: boolean;
  showDragHint: boolean;
}) {
  const s = props.spectrum;
  return (
    <div className="card p-3">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h3 className="text-sm font-semibold">MS1 Spectrum</h3>
        {s && (
          <div className="text-xs text-ink-500">
            RT {s.meta.rt_min.toFixed(3)} min · {s.meta.polarity ?? "unk"} ·{" "}
            {s.meta.n_peaks.toLocaleString()} peaks
            {props.showDragHint && s.labels.length > 0 ? " · drag labels to reposition" : ""}
          </div>
        )}
      </div>
      {!s ? (
        <div className="flex h-72 items-center justify-center text-sm text-ink-500">
          Click a point on the TIC to view the MS1 spectrum at that retention time.
        </div>
      ) : (
        <Plot
          data={[
            {
              type: "bar",
              x: s.mz,
              y: s.intensity,
              width: 0.5,
              marker: { color: "#323c50" },
              hovertemplate: "m/z: %{x:.4f}<br>int: %{y:.3e}<extra></extra>",
              name: "MS1",
            },
          ]}
          layout={{
            height: 340,
            margin: { l: 60, r: 20, t: 20, b: 40 },
            xaxis: { title: { text: "m/z" }, zeroline: false },
            yaxis: { title: { text: "intensity" }, zeroline: false, exponentformat: "e" },
            annotations: props.annotate
              ? s.labels.map((lbl) => ({
                  x: lbl.mz,
                  y: lbl.intensity,
                  text: lbl.mz.toFixed(4),
                  showarrow: false,
                  yshift: 10,
                  font: { size: 10, color: "#46536a" },
                }))
              : [],
            plot_bgcolor: "#ffffff",
            paper_bgcolor: "#ffffff",
            showlegend: false,
            bargap: 0,
            dragmode: props.showDragHint ? "pan" : "zoom",
          }}
          config={{ responsive: true, displaylogo: false, editable: props.showDragHint }}
          style={{ width: "100%" }}
          useResizeHandler
        />
      )}
    </div>
  );
}

function EmptyState(props: { onPick: () => void }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-4xl">📈</div>
      <div>
        <div className="text-lg font-semibold">Open an mzML file to begin</div>
        <div className="text-sm text-ink-500">
          The file is parsed with pyteomics on the backend and kept in memory.
        </div>
      </div>
      <button className="btn-primary" onClick={props.onPick}>
        Open mzML…
      </button>
    </div>
  );
}

// --- Status bar --------------------------------------------------------------

function StatusBar({
  mzml,
  uv,
  polarity,
  offset,
}: {
  mzml: string;
  uv: string;
  polarity: Polarity;
  offset: number;
}) {
  return (
    <footer className="flex shrink-0 items-center gap-4 border-t border-ink-200 bg-white px-6 py-1.5 text-[11px] text-ink-600">
      <span>
        <span className="font-medium text-ink-500">MzML:</span> {mzml}
      </span>
      <span className="text-ink-300">|</span>
      <span>
        <span className="font-medium text-ink-500">UV:</span> {uv}
      </span>
      <span className="text-ink-300">|</span>
      <span>
        <span className="font-medium text-ink-500">Polarity filter:</span>{" "}
        {polarity}
      </span>
      <span className="text-ink-300">|</span>
      <span>
        <span className="font-medium text-ink-500">UV↔MS offset:</span>{" "}
        {offset.toFixed(3)} min
      </span>
    </footer>
  );
}

// --- Dialogs -----------------------------------------------------------------

function Modal({
  title,
  onClose,
  children,
  footer,
  width = "max-w-xl",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/40 p-4">
      <div
        className={clsx(
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl",
          width,
        )}
      >
        <header className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            className="rounded-md p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-auto p-5 text-sm">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-ink-200 bg-ink-50/40 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

function FindMzDialog({
  input,
  setInput,
  tol,
  setTol,
  busy,
  onClose,
  onRun,
}: {
  input: string;
  setInput: (v: string) => void;
  tol: number;
  setTol: (v: number) => void;
  busy: boolean;
  onClose: () => void;
  onRun: () => void;
}) {
  return (
    <Modal
      title="Find m/z"
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn-primary" onClick={onRun} disabled={busy}>
            {busy ? "Searching…" : "Find"}
          </button>
        </>
      }
    >
      <p className="text-ink-600">
        Sweeps MS1 scans (sampled up to 200 probes) at the current polarity
        filter and jumps to the RT with the most intense peak within the
        tolerance window.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="label">Target m/z</div>
          <input
            type="number"
            step="0.0001"
            className="input mt-1 w-full"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <div className="label">Tolerance (Da)</div>
          <input
            type="number"
            step="0.001"
            className="input mt-1 w-full"
            value={tol}
            onChange={(e) => setTol(parseFloat(e.target.value) || 0.01)}
          />
        </div>
      </div>
    </Modal>
  );
}

function EICDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Extracted Ion Chromatogram"
      onClose={onClose}
      footer={
        <button
          className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
          onClick={onClose}
        >
          Close
        </button>
      }
    >
      <p className="text-ink-600">
        EIC chromatogram generation is not yet implemented in the web edition.
        Use the desktop app for full EIC support, or export labels and plot in
        Data Studio as an interim workflow.
      </p>
      <div className="mt-4 rounded-md border border-dashed border-ink-200 bg-ink-50/50 p-6 text-center text-sm text-ink-500">
        Coming soon
      </div>
    </Modal>
  );
}

function GraphSettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Graph Settings"
      onClose={onClose}
      footer={
        <button
          className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
          onClick={onClose}
        >
          Close
        </button>
      }
    >
      <p className="text-ink-600">
        Fine-grained graph customisation (font sizes, grid colours, tick
        density, custom titles) will land here in a future iteration. Use
        Plotly's built-in controls in the top-right of each chart for now.
      </p>
    </Modal>
  );
}

function PolymerDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Polymer / Reaction Match"
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={onClose}
          >
            Close
          </button>
          <button className="btn-primary" disabled>
            Apply
          </button>
        </>
      }
    >
      <p className="text-ink-600">
        Configure polymer rules, adduct handling, and tolerances for the
        current spectrum or selected TIC region.
      </p>
      <div className="mt-3 rounded-md border border-dashed border-ink-200 bg-ink-50/50 p-6 text-center text-sm text-ink-500">
        Polymer matching UI is available; wiring the backend engine to the web
        edition is planned for a follow-up release.
      </div>
    </Modal>
  );
}
