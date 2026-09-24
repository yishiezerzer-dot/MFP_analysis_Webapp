import { ReactNode } from "react";
import clsx from "clsx";
import { NumberSetting } from "./DialogControls";
import { CustomUvLabelDraft } from "../../lcms/viewShared";
import { Check } from "./ToolsPanel";

export function EmptyState(props: { onPick: () => void }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-4xl">📈</div>
      <div>
        <div className="text-lg font-semibold">Open an mzML or mzML.gz file to begin</div>
        <div className="text-sm text-ink-500">
          The file is parsed with pyteomics on the backend and cached for fast reloading.
        </div>
      </div>
      <button className="btn-primary" onClick={props.onPick}>
        Open mzML…
      </button>
    </div>
  );
}

// --- Status bar --------------------------------------------------------------

export function StatusBar({
  truncName,
  ms1Count,
  rtRange,
  polLabel,
  uvAttached,
  offset,
}: {
  truncName: string;
  ms1Count: number;
  rtRange: string | null;
  polLabel: string;
  uvAttached: boolean;
  offset: number;
}) {
  const sep = <span className="text-ink-300">·</span>;
  return (
    <footer className="flex shrink-0 items-center justify-between border-t border-ink-200 bg-surface px-6 py-1.5 text-[11px] text-ink-500">
      <span className="font-medium text-ink-700 truncate max-w-[220px]">
        {truncName || "No session loaded"}
      </span>
      <span className="flex items-center gap-2">
        {ms1Count > 0 && <>{ms1Count} MS1 scans {sep}</>}
        {rtRange && <>{rtRange} {sep}</>}
        <span>{polLabel}</span>
        {offset !== 0 && <>{sep} UV offset {offset.toFixed(3)} min</>}
      </span>
      <span className="flex items-center gap-1.5">
        {uvAttached ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            <span className="text-green-600">UV attached</span>
          </>
        ) : (
          <span className="text-ink-300">No UV</span>
        )}
      </span>
    </footer>
  );
}

// --- Dialogs -----------------------------------------------------------------

export function Modal({
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
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-xl",
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

export function FindMzDialog({
  input,
  setInput,
  tol,
  setTol,
  unit,
  setUnit,
  busy,
  onClose,
  onRun,
}: {
  input: string;
  setInput: (v: string) => void;
  tol: number;
  setTol: (v: number) => void;
  unit: "da" | "ppm";
  setUnit: (v: "da" | "ppm") => void;
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
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
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
        Sweeps MS1 scans at the current polarity filter and jumps to the RT with the
        most intense peak within the tolerance window.
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
          <div className="flex items-center justify-between">
            <span className="label">Tolerance ({unit === "da" ? "Da" : "ppm"})</span>
            <div className="inline-flex rounded border border-ink-200 bg-ink-50 p-0.5 text-xs">
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                  unit === "da" ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
                }`}
                onClick={() => {
                  if (unit !== "da") {
                    setUnit("da");
                    if (tol >= 1) setTol(0.01);
                  }
                }}
              >
                Da
              </button>
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                  unit === "ppm" ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
                }`}
                onClick={() => {
                  if (unit !== "ppm") {
                    setUnit("ppm");
                    if (tol < 0.1) setTol(10);
                  }
                }}
              >
                ppm
              </button>
            </div>
          </div>
          <input
            type="number"
            step={unit === "da" ? "0.001" : "1"}
            min={unit === "da" ? 0.0001 : 0.1}
            className="input mt-1 w-full"
            value={tol}
            onChange={(e) => setTol(Math.max(unit === "da" ? 0.0001 : 0.1, parseFloat(e.target.value) || (unit === "da" ? 0.01 : 10)))}
          />
        </div>
      </div>
    </Modal>
  );
}

export function CustomUvLabelDialog({
  draft,
  onChange,
  onClose,
  onSave,
}: {
  draft: CustomUvLabelDraft;
  onChange: (draft: CustomUvLabelDraft) => void;
  onClose: () => void;
  onSave: (draft: CustomUvLabelDraft) => void;
}) {
  const patch = (next: Partial<CustomUvLabelDraft>) => onChange({ ...draft, ...next });
  return (
    <Modal
      title={draft.id ? "Edit UV Label" : "Custom UV Label"}
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onSave(draft)}>
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="block">
          <div className="label">Label text</div>
          <input
            className="input mt-1 w-full"
            value={draft.text}
            autoFocus
            onChange={(e) => patch({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(draft);
            }}
          />
        </label>
        <NumberSetting
          label="UV RT (min)"
          value={Number.isFinite(parseFloat(draft.rtText)) ? parseFloat(draft.rtText) : null}
          step={0.0001}
          onChange={(value) => patch({ rtText: value == null ? "" : String(value) })}
        />
        <Check
          label="Snap to nearest UV peak"
          checked={draft.snap}
          onChange={(snap) => patch({ snap })}
        />
        <p className="text-xs text-ink-500">
          Clicking an existing label chip opens this dialog so you can rename it.
        </p>
      </div>
    </Modal>
  );
}

export function EICDialog({
  input,
  setInput,
  tol,
  setTol,
  unit,
  setUnit,
  busy,
  onClose,
  onRun,
}: {
  input: string;
  setInput: (v: string) => void;
  tol: number;
  setTol: (v: number) => void;
  unit: "da" | "ppm";
  setUnit: (v: "da" | "ppm") => void;
  busy: boolean;
  onClose: () => void;
  onRun: () => void;
}) {
  return (
    <Modal
      title="Extracted Ion Chromatogram"
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn-primary" onClick={onRun} disabled={busy}>
            {busy ? "Extracting..." : "Generate EIC"}
          </button>
        </>
      }
    >
      <p className="text-ink-600">
        Sum intensity across every MS1 scan inside the target m/z window.
        The strongest EIC point will also load its nearest MS1 spectrum.
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
          <div className="flex items-center justify-between">
            <span className="label">Tolerance ({unit === "da" ? "Da" : "ppm"})</span>
            <div className="inline-flex rounded border border-ink-200 bg-ink-50 p-0.5 text-xs">
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                  unit === "da" ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
                }`}
                onClick={() => {
                  if (unit !== "da") {
                    setUnit("da");
                    if (tol >= 1) setTol(0.01);
                  }
                }}
              >
                Da
              </button>
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                  unit === "ppm" ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
                }`}
                onClick={() => {
                  if (unit !== "ppm") {
                    setUnit("ppm");
                    if (tol < 0.1) setTol(10);
                  }
                }}
              >
                ppm
              </button>
            </div>
          </div>
          <input
            type="number"
            step={unit === "da" ? "0.001" : "1"}
            min={unit === "da" ? 0.0001 : 0.1}
            className="input mt-1 w-full"
            value={tol}
            onChange={(e) => setTol(Math.max(unit === "da" ? 0.0001 : 0.1, parseFloat(e.target.value) || (unit === "da" ? 0.01 : 10)))}
          />
        </div>
      </div>
    </Modal>
  );
}
