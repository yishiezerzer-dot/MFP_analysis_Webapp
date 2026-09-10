import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

export interface PeakContextData {
  mz: number;
  intensity: number;
  relIntensity?: number;
  label?: string;
  source?: string;
  sessionId?: string;
  fileName?: string;
  x: number; // Client or container X
  y: number; // Client or container Y
}

export interface PeakContextPopoverProps {
  peak: PeakContextData | null;
  onClose: () => void;
  onExtractEic?: (mz: number, sessionId?: string) => void;
  onDeconvolute?: (mz: number, sessionId?: string) => void;
  onMatchPolymer?: (mz: number, sessionId?: string) => void;
  className?: string;
}

export function PeakContextPopover({
  peak,
  onClose,
  onExtractEic,
  onDeconvolute,
  onMatchPolymer,
  className,
}: PeakContextPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!peak) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [peak, onClose]);

  if (!peak) return null;

  const copyMz = async () => {
    try {
      await navigator.clipboard.writeText(peak.mz.toFixed(4));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      ref={popoverRef}
      style={{
        left: `${Math.max(16, Math.min(window.innerWidth - 300, peak.x))}px`,
        top: `${Math.max(16, peak.y - 120)}px`,
      }}
      className={clsx(
        "fixed z-50 w-72 rounded-xl border border-ink-200 bg-surface/95 p-3.5 shadow-2xl backdrop-blur-md transition-all animate-in fade-in-0 zoom-in-95",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-ink-100 pb-2.5">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Peak Details
            </span>
            {peak.label && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                {peak.label}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-base font-bold text-ink-900">
              m/z {peak.mz.toFixed(4)}
            </span>
            <button
              type="button"
              onClick={copyMz}
              className="text-[11px] text-brand-600 hover:text-brand-700 hover:underline"
              title="Copy exact m/z to clipboard"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
          <div className="text-[11px] text-ink-500">
            Intensity: {peak.intensity.toExponential(3)}
            {peak.relIntensity != null && (
              <span> · {(peak.relIntensity * 100).toFixed(1)}% rel</span>
            )}
          </div>
          {peak.fileName && (
            <div className="mt-0.5 truncate text-[11px] font-medium text-ink-600" title={peak.fileName}>
              Source: {peak.fileName}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <div className="mt-2.5 flex flex-col gap-1.5">
        {onExtractEic && (
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-600"
            onClick={() => {
              onExtractEic(peak.mz, peak.sessionId);
              onClose();
            }}
          >
            <span>📈</span>
            <span>Extract EIC Chromatogram</span>
          </button>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {onDeconvolute && (
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-100 hover:text-ink-900"
              onClick={() => {
                onDeconvolute(peak.mz, peak.sessionId);
                onClose();
              }}
              title="Deconvolute multicharge ESI cluster around this m/z"
            >
              <span>⚛️</span>
              <span>Deconvolute</span>
            </button>
          )}

          {onMatchPolymer && (
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-100 hover:text-ink-900"
              onClick={() => {
                onMatchPolymer(peak.mz, peak.sessionId);
                onClose();
              }}
              title="Inspect monomer composition & Kendrick defect"
            >
              <span>🧬</span>
              <span>Polymer Match</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
