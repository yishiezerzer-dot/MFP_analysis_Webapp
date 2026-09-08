import { useMemo, useState } from "react";
import type { LCMSFeatureRow } from "../../lcms/analysis";
import { Modal } from "./DialogControls";

export type FeatureSortKey = "rtApex" | "mz" | "height" | "area" | "sn";
export type FeatureSortDir = "asc" | "desc";

export function FeatureTableDialog({
  rows,
  onDelete,
  onClear,
  onExportCsv,
  onClose,
  onUpdate,
  onLocate,
}: {
  rows: LCMSFeatureRow[];
  onDelete: (id: string) => void;
  onClear: () => void;
  onExportCsv: () => void;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<LCMSFeatureRow>) => void;
  onLocate: (eicPlotId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<FeatureSortKey>("rtApex");
  const [sortDir, setSortDir] = useState<FeatureSortDir>("asc");
  const snFor = (row: LCMSFeatureRow): number => (row.baseline > 0 ? row.height / row.baseline : Infinity);
  const sortedRows = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    const getter: (r: LCMSFeatureRow) => number =
      sortKey === "rtApex"
        ? (r) => r.rtApex
        : sortKey === "mz"
          ? (r) => r.mz
          : sortKey === "height"
            ? (r) => r.height
            : sortKey === "area"
              ? (r) => r.area
              : snFor;
    return [...rows].sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (!Number.isFinite(va) && !Number.isFinite(vb)) return 0;
      if (!Number.isFinite(va)) return 1;
      if (!Number.isFinite(vb)) return -1;
      return (va - vb) * factor;
    });
  }, [rows, sortKey, sortDir]);
  const toggleSort = (key: FeatureSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "rtApex" || key === "mz" ? "asc" : "desc");
    }
  };
  const sortIndicator = (key: FeatureSortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <Modal
      title="Feature Table"
      onClose={onClose}
      width="max-w-6xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={rows.length === 0}
            onClick={onClear}
          >
            Clear table
          </button>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
              disabled={rows.length === 0}
              onClick={onExportCsv}
            >
              Export CSV
            </button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
          Integrate generated EICs to add rows here. Area is baseline-corrected trapezoid integration around the strongest EIC apex.
        </div>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            No features yet. Generate an EIC, then press Integrate on the EIC plot.
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto rounded-md border border-ink-200">
            <table className="min-w-full divide-y divide-ink-200 text-xs">
              <thead className="sticky top-0 bg-ink-50 text-left text-ink-600">
                <tr>
                  <th className="px-2 py-2 font-medium">Feature</th>
                  <th className="cursor-pointer select-none px-2 py-2 font-medium hover:text-ink-900" onClick={() => toggleSort("mz")}>
                    m/z{sortIndicator("mz")}
                  </th>
                  <th className="cursor-pointer select-none px-2 py-2 font-medium hover:text-ink-900" onClick={() => toggleSort("rtApex")}>
                    RT apex{sortIndicator("rtApex")}
                  </th>
                  <th className="px-2 py-2 font-medium">RT window</th>
                  <th className="cursor-pointer select-none px-2 py-2 font-medium hover:text-ink-900" onClick={() => toggleSort("height")}>
                    Height{sortIndicator("height")}
                  </th>
                  <th className="cursor-pointer select-none px-2 py-2 font-medium hover:text-ink-900" onClick={() => toggleSort("area")}>
                    Area{sortIndicator("area")}
                  </th>
                  <th className="px-2 py-2 font-medium">Baseline</th>
                  <th className="cursor-pointer select-none px-2 py-2 font-medium hover:text-ink-900" onClick={() => toggleSort("sn")}>
                    S/N{sortIndicator("sn")}
                  </th>
                  <th className="px-2 py-2 font-medium">Evidence</th>
                  <th className="px-2 py-2 font-medium">Source</th>
                  <th className="px-2 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 bg-surface">
                {sortedRows.map((row, index) => {
                  const sn = snFor(row);
                  return (
                    <tr key={row.id}>
                      <td className="max-w-[240px] px-2 py-1.5">
                        <div className="font-medium text-ink-800">F{index + 1}</div>
                        <input
                          type="text"
                          className="mt-0.5 w-full rounded border border-ink-200 bg-surface px-1.5 py-0.5 text-[11px] text-ink-700 focus:border-brand-500 focus:outline-none"
                          placeholder="Label…"
                          value={row.label ?? ""}
                          onChange={(e) => onUpdate(row.id, { label: e.target.value || undefined })}
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono">
                        {row.mz.toFixed(4)}
                        <div className="text-[11px] text-ink-400">+/- {row.tolerance.toFixed(4)}</div>
                      </td>
                      <td className="px-2 py-1.5 font-mono">{row.rtApex.toFixed(3)}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {row.rtStart.toFixed(3)}-{row.rtEnd.toFixed(3)}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{row.height.toExponential(2)}</td>
                      <td className="px-2 py-1.5 font-mono">{row.area.toExponential(2)}</td>
                      <td className="px-2 py-1.5 font-mono">{row.baseline.toExponential(2)}</td>
                      <td className="px-2 py-1.5 font-mono">{Number.isFinite(sn) ? sn.toFixed(1) : "—"}</td>
                      <td className="max-w-[240px] px-2 py-1.5">
                        <div className="truncate">{row.expectedProduct || row.source}</div>
                        <input
                          type="text"
                          className="mt-0.5 w-full rounded border border-ink-200 bg-surface px-1.5 py-0.5 text-[11px] text-ink-700 focus:border-brand-500 focus:outline-none"
                          placeholder="Annotation…"
                          value={row.annotation ?? ""}
                          onChange={(e) => onUpdate(row.id, { annotation: e.target.value || undefined })}
                        />
                      </td>
                      <td className="max-w-[180px] px-2 py-1.5">
                        <div className="truncate">{row.sourceFile}</div>
                        <div className="text-[11px] text-ink-500">{row.polarity ?? "unknown"}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <button
                            className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-ink-50"
                            onClick={() => onLocate(row.eicPlotId)}
                            title="Scroll to and highlight this row's EIC plot"
                          >
                            Open EIC
                          </button>
                          <button
                            className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-ink-50"
                            onClick={() => onDelete(row.id)}
                          >
                            Remove
                          </button>
                        </div>
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
