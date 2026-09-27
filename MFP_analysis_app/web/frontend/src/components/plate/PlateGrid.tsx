import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import type { PlateLayout, PlateWell } from "../../api";
import {
  COLS,
  ROWS,
  concentrationOfPosition,
  formatConcentration,
  odFill,
  positionLabel,
  roleOfWell,
  wellsBetween,
  type WellRole,
} from "../../utils/plateLayout";

export const GC_RING = "rgb(var(--ink-900))";
export const BLANK_RING = "rgb(var(--ink-400))";

export function ringColour(role: WellRole): string | null {
  if (role.kind === "group") return role.group.colour || "#405a9c";
  if (role.kind === "growth_control") return GC_RING;
  if (role.kind === "blank") return BLANK_RING;
  return null;
}

function roleName(role: WellRole): string {
  if (role.kind === "group") return role.group.name;
  if (role.kind === "growth_control") return "growth control";
  if (role.kind === "blank") return "blank";
  return "unassigned";
}

// 8×12 plate: OD fill, group ring, concentration headers. Click a well to exclude/include it;
// drag across wells to paint them (only when `onPaint` is given). Escape cancels a drag.
export function PlateGrid({
  values,
  layout,
  onToggleExcluded,
  onPaint,
  compact = false,
}: {
  values: Record<PlateWell, number | null>;
  layout: PlateLayout;
  onToggleExcluded?: (well: PlateWell) => void;
  onPaint?: (wells: PlateWell[]) => void;
  compact?: boolean;
}) {
  const [drag, setDrag] = useState<{ from: PlateWell; to: PlateWell } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const interactive = Boolean(onToggleExcluded || onPaint);

  const max = useMemo(
    () => Math.max(0, ...Object.values(values).filter((v): v is number => typeof v === "number")),
    [values],
  );
  const selection = useMemo(() => new Set(drag ? wellsBetween(drag.from, drag.to) : []), [drag]);
  const excluded = useMemo(() => new Set(layout.excluded), [layout.excluded]);
  const byColumns = layout.dilution.direction === "columns";

  useEffect(() => {
    if (!interactive) return;
    const finish = () => {
      const d = dragRef.current;
      if (!d) return;
      setDrag(null);
      if (d.from === d.to) onToggleExcluded?.(d.from);
      else onPaint?.(wellsBetween(d.from, d.to));
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setDrag(null);
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("keydown", onKey);
    };
  }, [interactive, onPaint, onToggleExcluded]);

  const onWellKey = (e: KeyboardEvent, well: PlateWell) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggleExcluded?.(well);
    }
  };

  const colHeader = (c: number) => (byColumns ? positionLabel(c, layout) : "");
  const rowHeader = (i: number) => (byColumns ? "" : positionLabel(i + 1, layout));
  const cell = compact ? "h-6 w-9 text-[12px]" : "h-[30px] w-[46px] text-[12px]";

  return (
    <table
      className="select-none border-separate"
      style={{ borderSpacing: compact ? 3 : 5 }}
      aria-label="96-well plate"
    >
      <thead>
        <tr>
          <th />
          {COLS.map((c) => (
            <th key={c} scope="col" className="text-center text-[12px] font-medium text-ink-500">
              {c}
              {!compact && <div className="text-mono-val font-normal text-ink-500">{colHeader(c) || " "}</div>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROWS.map((r, i) => (
          <tr key={r}>
            <th scope="row" className="pr-1 text-right text-[12px] font-medium text-ink-500">
              {r}
              {!compact && rowHeader(i) && <span className="text-mono-val ml-1 font-normal">{rowHeader(i)}</span>}
            </th>
            {COLS.map((c) => {
              const well = `${r}${c}`;
              const value = values[well] ?? null;
              const role = roleOfWell(layout, well);
              const ring = ringColour(role);
              const isExcluded = excluded.has(well);
              const fill = odFill(value, max);
              const conc = role.kind === "group"
                ? concentrationOfPosition(byColumns ? c : i + 1, layout.dilution)
                : null;
              const label = [
                well,
                value === null ? "no value" : `OD ${value.toFixed(3)}`,
                roleName(role),
                conc !== null && `${formatConcentration(conc)} ${layout.dilution.unit}`,
                isExcluded && "excluded",
              ].filter(Boolean).join(", ");
              const style = {
                ...(isExcluded ? {} : fill),
                boxShadow: [
                  ring && `0 0 0 2px ${ring}`,
                  selection.has(well) && "0 0 0 4px rgb(var(--brand-500) / 0.45)",
                ].filter(Boolean).join(", ") || undefined,
              };
              const text = value === null ? "–" : value.toFixed(2);
              return (
                <td key={c} className="p-0">
                  {interactive ? (
                    <button
                      type="button"
                      aria-label={label}
                      title={label}
                      aria-pressed={isExcluded}
                      className={clsx(
                        cell,
                        "block rounded-full font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                        isExcluded && "plate-well-excluded",
                      )}
                      style={style}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        setDrag({ from: well, to: well });
                      }}
                      onPointerEnter={() => setDrag((d) => (d && onPaint ? { ...d, to: well } : d))}
                      onKeyDown={(e) => onWellKey(e, well)}
                    >
                      {text}
                    </button>
                  ) : (
                    <div
                      title={label}
                      className={clsx(cell, "flex items-center justify-center rounded-full font-mono", isExcluded && "plate-well-excluded")}
                      style={style}
                    >
                      {text}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
