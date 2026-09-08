import { useMemo, useState } from "react";
import {
  api,
  type SpectrumData,
  type TICData,
} from "../../api";
import {
  buildExpectedProductHits,
  buildSpectrumIndex,
  EXPECTED_PRODUCT_MAX_DP,
  rowsToCsv,
  type ExpectedProductHit,
  type ExpectedProductResolutionMode,
  type LCMSEICMetadata,
  type Polarity,
  type PolymerUiSettings,
} from "../../lcms/analysis";
import { Modal, NumberSetting, SelectSetting } from "./DialogControls";

function formatScanId(spectrumId: string): string {
  const m = /scan=(\d+)/i.exec(spectrumId);
  if (m) return m[1];
  const m2 = /scan\s+(\d+)/i.exec(spectrumId);
  if (m2) return m2[1];
  return spectrumId;
}

export function ExpectedProductsDialog({
  polarity,
  settings,
  spectrum,
  tic,
  activeSid,
  onCreateEic,
  onClose,
}: {
  polarity: Exclude<Polarity, "all">;
  settings: PolymerUiSettings;
  spectrum: SpectrumData | null;
  tic: TICData | null;
  activeSid: string | null;
  onCreateEic: (mz: number, tolerance: number, metadata?: Partial<LCMSEICMetadata>) => void;
  onClose: () => void;
}) {
  const [maxDp, setMaxDp] = useState(3);
  const [resolutionMode, setResolutionMode] = useState<ExpectedProductResolutionMode>("normal");
  const [lowResolutionTolerance, setLowResolutionTolerance] = useState(0.15);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [allScansThresholdPct, setAllScansThresholdPct] = useState(5);
  const [exportingAllScans, setExportingAllScans] = useState(false);
  const VISIBLE_ROW_CAP = 300;
  const spectrumIndex = useMemo(() => (spectrum ? buildSpectrumIndex(spectrum) : null), [spectrum]);
  const rows = useMemo(
    () =>
      spectrumIndex
        ? buildExpectedProductHits(
            settings,
            polarity,
            spectrumIndex,
            maxDp,
            resolutionMode,
            lowResolutionTolerance,
          )
        : [],
    [lowResolutionTolerance, maxDp, polarity, resolutionMode, settings, spectrumIndex],
  );
  const filteredRows = showUnmatched ? rows : rows.filter((row) => row.observedMz != null);
  const visibleRows = filteredRows.slice(0, VISIBLE_ROW_CAP);
  const truncated = filteredRows.length > VISIBLE_ROW_CAP;
  const matchedCount = rows.filter((row) => row.observedMz != null).length;

  const CSV_HEADER = ["RT_min", "Scan", "Composition", "Variant", "Ion", "ExpectedMz", "ObservedMz", "AbsErrDa", "PpmErr", "Intensity", "ToleranceDa"];
  const rowToCsvCells = (r: ExpectedProductHit, rt: number, scanId: string) =>
    [rt.toFixed(4), scanId, r.composition, r.variant, r.ion,
      r.expectedMz.toFixed(6), r.observedMz?.toFixed(6) ?? "",
      r.absErr?.toFixed(6) ?? "", r.ppmErr?.toFixed(2) ?? "",
      r.intensity?.toExponential(4) ?? "", r.toleranceDa.toFixed(6),
    ];

  const downloadCsv = () => {
    if (!spectrum) return;
    const rt = spectrum.meta.rt_min;
    const scanId = spectrum.meta.spectrum_id.startsWith("summed:")
      ? `summed:${rt.toFixed(3)}`
      : formatScanId(spectrum.meta.spectrum_id);
    const csv = rowsToCsv([CSV_HEADER, ...rows.map((r) => rowToCsvCells(r, rt, scanId))]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expected_products_rt${rt.toFixed(3)}_dp${maxDp}_${polarity}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllScansCsv = async () => {
    if (!activeSid || !tic || tic.rt_min.length === 0) return;
    const maxTic = Math.max(...tic.tic);
    const threshold = maxTic * (allScansThresholdPct / 100);
    const rtsAboveThreshold = tic.rt_min.filter((_, i) => tic.tic[i] >= threshold);
    if (rtsAboveThreshold.length === 0) return;
    setExportingAllScans(true);
    const allRows: Array<Array<string | number>> = [CSV_HEADER];
    try {
      for (const rt of rtsAboveThreshold) {
        const sp = await api.lcms.spectrum(activeSid, {
          rt_min: rt,
          polarity: polarity === "positive" ? "positive" : "negative",
          top_n: 0,
          min_rel: 0,
        });
        const idx = buildSpectrumIndex(sp);
        const hits = buildExpectedProductHits(settings, polarity, idx, maxDp, resolutionMode, lowResolutionTolerance);
        const matched = hits.filter((r) => r.observedMz != null);
        const scanId = sp.meta.spectrum_id.startsWith("summed:")
          ? `summed:${rt.toFixed(3)}`
          : formatScanId(sp.meta.spectrum_id);
        for (const r of matched) {
          allRows.push(rowToCsvCells(r, rt, scanId));
        }
      }
      const csv = rowsToCsv(allRows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expected_products_all_scans_dp${maxDp}_${polarity}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingAllScans(false);
    }
  };

  return (
    <Modal
      title="Expected Products"
      onClose={onClose}
      footer={<button className="btn-primary" onClick={onClose}>Done</button>}
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
          Matching expected oligomer products against the currently displayed MS1 spectrum.
        </div>
        <div className="grid grid-cols-4 gap-3">
          <NumberSetting
            label="Max oligomer size"
            value={maxDp}
            min={1}
            max={EXPECTED_PRODUCT_MAX_DP}
            step={1}
            onChange={(value) =>
              setMaxDp(Math.max(1, Math.min(EXPECTED_PRODUCT_MAX_DP, Math.round(value ?? 3))))
            }
          />
          <SelectSetting
            label="Resolution mode"
            value={resolutionMode}
            options={[
              { value: "normal", label: "Normal tolerance" },
              { value: "low", label: "Low resolution" },
            ]}
            onChange={(value) => setResolutionMode(value as ExpectedProductResolutionMode)}
          />
          <div title="Floor for matching in low-res mode. Configured ppm/Da is still used if wider.">
            <NumberSetting
              label="Low-res tolerance (Da)"
              value={lowResolutionTolerance}
              min={0.01}
              max={2}
              step={0.01}
              onChange={(value) => setLowResolutionTolerance(Math.max(0.01, value ?? 0.15))}
            />
          </div>
          <label className="flex items-end gap-2 pb-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={showUnmatched}
              onChange={(event) => setShowUnmatched(event.target.checked)}
            />
            Show unmatched candidates
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <div className="self-end pb-2 text-xs text-ink-500">
            {matchedCount} matched / {rows.length} candidates
            {truncated && (
              <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                showing first {VISIBLE_ROW_CAP}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pb-2">
            {resolutionMode === "low" && (
              <span>
                Low resolution mode uses at least ± {lowResolutionTolerance.toFixed(2)} Da for matching.
              </span>
            )}
            <button
              className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
              onClick={downloadCsv}
              disabled={rows.length === 0 || !spectrum}
            >
              Export current scan CSV
            </button>
            <div className="flex items-center gap-1.5">
              <button
                className="rounded-md border border-brand-300 bg-surface px-2 py-1 text-xs text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-400"
                onClick={() => void downloadAllScansCsv()}
                disabled={exportingAllScans || !activeSid || !tic}
                title={`Export matched products from all TIC scans above ${allScansThresholdPct}% of max TIC intensity`}
              >
                {exportingAllScans ? "Exporting…" : "Export all scans CSV"}
              </button>
              <span className="text-xs text-ink-500">TIC threshold:</span>
              <input
                type="number"
                className="input w-16 text-xs"
                value={allScansThresholdPct}
                min={0.1}
                max={100}
                step={0.5}
                onChange={(e) => setAllScansThresholdPct(Math.max(0.1, Math.min(100, parseFloat(e.target.value) || 5)))}
              />
              <span className="text-xs text-ink-500">% of max</span>
            </div>
          </div>
        </div>
        {!spectrum ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            Load an MS1 spectrum first.
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            No expected products matched the current spectrum with the current tolerance.
          </div>
        ) : (
          <div className="max-h-[460px] overflow-auto rounded-md border border-ink-200">
            <table className="min-w-full divide-y divide-ink-200 text-xs">
              <thead className="sticky top-0 bg-ink-50 text-left text-ink-600">
                <tr>
                  <th className="px-2 py-2 font-medium">Product</th>
                  <th className="px-2 py-2 font-medium">Ion</th>
                  <th className="px-2 py-2 font-medium">Expected m/z</th>
                  <th className="px-2 py-2 font-medium">Observed</th>
                  <th className="px-2 py-2 font-medium">Error</th>
                  <th className="px-2 py-2 font-medium">Intensity</th>
                  <th className="px-2 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 bg-surface">
                {visibleRows.map((row) => {
                  const mzForEic = row.observedMz ?? row.expectedMz;
                  return (
                    <tr key={row.id} className={row.observedMz == null ? "text-ink-400" : "text-ink-700"}>
                      <td className="max-w-[220px] px-2 py-1.5">
                        <div className="truncate font-medium">{row.composition}</div>
                        {row.variant ? <div className="text-[11px] text-ink-500">{row.variant}</div> : null}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{row.ion}</td>
                      <td className="px-2 py-1.5 font-mono">{row.expectedMz.toFixed(4)}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {row.observedMz != null ? row.observedMz.toFixed(4) : "-"}
                      </td>
                      <td className="px-2 py-1.5">
                        {row.absErr != null && row.ppmErr != null
                          ? `${row.absErr.toFixed(4)} Da / ${row.ppmErr.toFixed(1)} ppm`
                          : "-"}
                      </td>
                      <td className="px-2 py-1.5 font-mono">
                        {row.intensity != null ? row.intensity.toExponential(2) : "-"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-ink-50"
                          onClick={() =>
                            onCreateEic(mzForEic, row.toleranceDa, {
                              label: `${row.composition} ${row.ion}`,
                              expectedProduct: row.composition,
                              annotation: [row.variant, row.ion].filter(Boolean).join(" "),
                            })
                          }
                        >
                          EIC
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
