import { useMemo, useState } from "react";
import type { LCMSSessionSummary } from "../../api";
import {
  featureMatrixValue,
  groupFeatureRowsForMatrix,
  type FeatureMatrixGroupMode,
  type FeatureMatrixMetric,
  type LCMSFeatureRow,
} from "../../lcms/analysis";
import { Modal, NumberSetting, SelectSetting } from "./DialogControls";

export function ComparisonMatrixDialog({
  rows,
  sessions,
  onExportCsv,
  onClose,
}: {
  rows: LCMSFeatureRow[];
  sessions: LCMSSessionSummary[];
  onExportCsv: (
    rows: LCMSFeatureRow[],
    options: {
      metric: FeatureMatrixMetric;
      groupMode: FeatureMatrixGroupMode;
      mzTolerance: number;
      normalizeRows: boolean;
    },
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [metric, setMetric] = useState<FeatureMatrixMetric>("area");
  const [groupMode, setGroupMode] = useState<FeatureMatrixGroupMode>("evidence");
  const [mzTolerance, setMzTolerance] = useState(0.05);
  const [normalizeRows, setNormalizeRows] = useState(false);
  const matrix = useMemo(
    () => groupFeatureRowsForMatrix(rows, sessions, { metric, groupMode, mzTolerance }),
    [groupMode, metric, mzTolerance, rows, sessions],
  );
  const { groups, columnIds, columnLabels } = matrix;
  const columnLabel = (id: string) => columnLabels[id] ?? id;
  const valueFor = (row: LCMSFeatureRow) => featureMatrixValue(row, metric);
  const cellMaxValue = (group: (typeof groups)[number]): number => {
    let max = 0;
    for (const cell of Object.values(group.cells)) {
      const v = valueFor(cell.row);
      if (v > max) max = v;
    }
    return max;
  };
  const formatCellValue = (cell: { row: LCMSFeatureRow } | undefined, maxValue: number) => {
    if (!cell) return "";
    const value = valueFor(cell.row);
    if (normalizeRows && maxValue > 0) return `${((value / maxValue) * 100).toFixed(1)}%`;
    return value >= 1000 || value < 0.01 ? value.toExponential(2) : value.toFixed(2);
  };
  const formatRtRange = (group: (typeof groups)[number]): string => {
    const spread = group.rtMax - group.rtMin;
    return spread > 0.01 ? `${group.rtMin.toFixed(3)}–${group.rtMax.toFixed(3)}` : group.rtApex.toFixed(3);
  };
  return (
    <Modal
      title="Comparison Matrix"
      onClose={onClose}
      width="max-w-7xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs text-ink-500">
            {groups.length} feature group{groups.length === 1 ? "" : "s"} across {columnIds.length} sample{columnIds.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
              disabled={groups.length === 0}
              onClick={() =>
                void onExportCsv(rows, {
                  metric,
                  groupMode,
                  mzTolerance,
                  normalizeRows,
                })
              }
            >
              Export CSV
            </button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-4 gap-3">
          <SelectSetting
            label="Value"
            value={metric}
            options={[
              { value: "area", label: "Peak area" },
              { value: "height", label: "Peak height" },
            ]}
            onChange={(value) => setMetric(value as FeatureMatrixMetric)}
          />
          <SelectSetting
            label="Group rows by"
            value={groupMode}
            options={[
              { value: "evidence", label: "Evidence/label first" },
              { value: "mz", label: "m/z tolerance only" },
            ]}
            onChange={(value) => setGroupMode(value as FeatureMatrixGroupMode)}
          />
          <NumberSetting
            label="m/z grouping tolerance"
            value={mzTolerance}
            min={0.0001}
            max={2}
            step={0.001}
            onChange={(value) => setMzTolerance(Math.max(0.0001, value ?? 0.05))}
          />
          <label className="flex items-end gap-2 pb-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={normalizeRows}
              onChange={(event) => setNormalizeRows(event.target.checked)}
            />
            Normalize each row to 100%
          </label>
        </div>
        <div className="rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
          This matrix uses integrated EIC features. Integrate matching EICs in each sample, then compare area or height here.
        </div>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            No integrated features yet. Generate and integrate EICs in one or more samples first.
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto rounded-md border border-ink-200">
            <table className="min-w-full divide-y divide-ink-200 text-xs">
              <thead className="sticky top-0 z-10 bg-ink-50 text-left text-ink-600">
                <tr>
                  <th className="sticky left-0 z-20 min-w-[220px] bg-ink-50 px-2 py-2 font-medium">Feature</th>
                  <th className="px-2 py-2 font-medium">m/z</th>
                  <th className="px-2 py-2 font-medium">RT</th>
                  <th className="px-2 py-2 font-medium">Polarity</th>
                  {columnIds.map((id) => (
                    <th key={id} className="min-w-[120px] px-2 py-2 font-medium">
                      <div className="max-w-[150px] truncate" title={columnLabel(id)}>
                        {columnLabel(id)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 bg-surface">
                {groups.map((group) => {
                  const maxValue = cellMaxValue(group);
                  return (
                    <tr key={group.id}>
                      <td className="sticky left-0 z-10 max-w-[260px] bg-surface px-2 py-1.5">
                        <div className="truncate font-medium text-ink-800" title={group.label}>{group.label}</div>
                        {group.annotation ? <div className="truncate text-[11px] text-ink-500">{group.annotation}</div> : null}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{group.mz.toFixed(4)}</td>
                      <td className="px-2 py-1.5 font-mono" title={`RT range ${group.rtMin.toFixed(3)}–${group.rtMax.toFixed(3)}`}>{formatRtRange(group)}</td>
                      <td className="px-2 py-1.5">{group.polarity ?? "unknown"}</td>
                      {columnIds.map((id) => {
                        const cell = group.cells[id];
                        const extra = cell?.collisions.length ?? 0;
                        return (
                          <td key={id} className="px-2 py-1.5 font-mono">
                            <div className="flex items-baseline gap-1">
                              <span>{formatCellValue(cell, maxValue) || "-"}</span>
                              {extra > 0 ? (
                                <span
                                  className="rounded bg-amber-100 px-1 text-[10px] text-amber-800"
                                  title={`${extra} additional row${extra === 1 ? "" : "s"} matched this (group, sample)`}
                                >
                                  +{extra}
                                </span>
                              ) : null}
                            </div>
                            {cell && normalizeRows ? (
                              <div className="text-[11px] text-ink-400">
                                {valueFor(cell.row).toExponential(2)}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
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
