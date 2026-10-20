import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { Check, Download, X } from "lucide-react";
import { api, type PipelineFile, type PipelineLabel, type PipelineResult, type PipelineReview, type PipelineUVPeak } from "../../api";
import { downloadBlob } from "../../lcms/viewShared";
import { ICON_PROPS } from "../common/ChartCardParts";
import { Hint } from "../Hint";

type Filter = "kept" | "todo" | "flagged" | "approved" | "all";
type Sort = "rt" | "status" | "score";

const STATUS_ORDER: Record<PipelineLabel["status"], number> = { flagged: 0, ok: 1, alternative: 2 };

const STATUS_STYLE: Record<PipelineLabel["status"], string> = {
  ok: "bg-success-surface text-success-fg",
  flagged: "bg-warning-surface text-warning-fg",
  alternative: "bg-ink-100 text-ink-600",
};

const FILE_LABEL: Record<PipelineFile, string> = {
  "figure.svg": "SVG",
  "figure.png": "PNG",
  "figure-print.png": "PNG 600 dpi",
  "peaks.xlsx": "xlsx",
};

export function visibleLabels(result: PipelineResult, filter: Filter): PipelineLabel[] {
  const topK = result.settings.rules.top_k;
  return result.labels.filter((lab) =>
    filter === "all"
      ? true
      : filter === "kept"
        ? lab.rank <= topK
        : filter === "todo"
          ? lab.rank <= topK && lab.review === "pending"
          : filter === "flagged"
            ? lab.status === "flagged"
            : lab.review === "approved",
  );
}

export function sortLabels(labels: PipelineLabel[], sort: Sort, rtOf: (peakId: string) => number): PipelineLabel[] {
  const byRt = (a: PipelineLabel, b: PipelineLabel) => rtOf(a.peak_id) - rtOf(b.peak_id) || a.rank - b.rank;
  const compare =
    sort === "status"
      ? (a: PipelineLabel, b: PipelineLabel) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byRt(a, b)
      : sort === "score"
        ? (a: PipelineLabel, b: PipelineLabel) => b.score - a.score || byRt(a, b)
        : byRt;
  return [...labels].sort(compare);
}

export function PipelineReviewPanel(props: {
  jobId: string;
  result: PipelineResult;
  onResult: (next: PipelineResult) => void;
  onJump: (peak: PipelineUVPeak) => void;
  onClose: () => void;
}) {
  const { result } = props;
  const [filter, setFilter] = useState<Filter>("kept");
  const [sort, setSort] = useState<Sort>("rt");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const peakById = useMemo(() => new Map(result.peaks.map((p) => [p.id, p])), [result.peaks]);
  const rows = sortLabels(visibleLabels(result, filter), sort, (id) => peakById.get(id)?.rt_min ?? 0);
  const approved = result.labels.filter((l) => l.review === "approved").length;
  const flagged = result.labels.filter((l) => l.status === "flagged").length;
  // Bulk: only top-ranked OK labels (one label per peak); flagged ones always need a look.
  const okToApprove = result.labels.filter((l) => l.rank === 1 && l.status === "ok" && l.review !== "approved");
  const flaggedUndecided = result.labels.filter((l) => l.status === "flagged" && l.review === "pending");
  const current = cursor >= 0 && cursor < rows.length ? rows[cursor] : null;

  useEffect(() => {
    if (current) rowRefs.current.get(current.id)?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const send = async (updates: Array<{ id: string; review: PipelineReview }>, busyKey: string) => {
    if (updates.length === 0) return;
    setBusy(busyKey);
    setError(null);
    try {
      props.onResult(await api.lcmsPipeline.review(props.jobId, updates));
    } catch (err) {
      setError(String(err).replace(/^Error: (HTTP \d+: )?/, ""));
    } finally {
      setBusy(null);
    }
  };

  const review = (label: PipelineLabel, next: PipelineReview) =>
    send([{ id: label.id, review: label.review === next ? "pending" : next }], label.id);

  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    const key = e.key.toLowerCase();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, Math.min(rows.length - 1, c + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (current && (key === "a" || key === "r")) {
      e.preventDefault();
      void review(current, key === "a" ? "approved" : "rejected");
    } else if (current && e.key === "Enter") {
      e.preventDefault();
      const peak = peakById.get(current.peak_id);
      if (peak) props.onJump(peak);
    }
  };

  const download = async (file: PipelineFile) => {
    try {
      const stem = result.display_name.replace(/\.[^.]+$/, "") || "lcms";
      downloadBlob(await api.lcmsPipeline.download(props.jobId, file), `${stem}_pipeline_${file}`);
    } catch (err) {
      setError(String(err).replace(/^Error: (HTTP \d+: )?/, ""));
    }
  };

  return (
    <section className="card flex flex-col gap-3 p-3" aria-label="Pipeline review">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <h3 className="text-card-title">Pipeline review</h3>
          <p className="text-caption">
            {result.peaks.length} UV peaks · UV→MS offset {result.alignment.offset_min >= 0 ? "+" : ""}
            {result.alignment.offset_min.toFixed(3)} min · {approved} approved · {flagged} flagged
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Hint id="lcms.pipeline.filter">
            <select className="input py-1 text-xs" aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="kept">Top {result.settings.rules.top_k} per peak</option>
              <option value="todo">To review</option>
              <option value="flagged">Flagged</option>
              <option value="approved">Approved</option>
              <option value="all">All candidates</option>
            </select>
          </Hint>
          <Hint id="lcms.pipeline.sort">
            <select className="input py-1 text-xs" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="rt">By retention time</option>
              <option value="status">Flagged first</option>
              <option value="score">By match score</option>
            </select>
          </Hint>
          <Hint id="lcms.pipeline.bulk">
            <div className="flex gap-1">
              <button
                type="button"
                className="btn-ghost border border-ink-200 px-2 py-1 text-xs"
                disabled={busy !== null || okToApprove.length === 0}
                onClick={() => void send(okToApprove.map((l) => ({ id: l.id, review: "approved" as const })), "bulk")}
              >
                <Check {...ICON_PROPS} />
                Approve OK ({okToApprove.length})
              </button>
              <button
                type="button"
                className="btn-ghost border border-ink-200 px-2 py-1 text-xs"
                disabled={busy !== null || flaggedUndecided.length === 0}
                onClick={() => void send(flaggedUndecided.map((l) => ({ id: l.id, review: "rejected" as const })), "bulk")}
              >
                <X {...ICON_PROPS} />
                Reject flagged ({flaggedUndecided.length})
              </button>
            </div>
          </Hint>
          <Hint id="lcms.pipeline.download">
            <div className="flex gap-1">
              {(["figure.svg", "figure.png", "figure-print.png", "peaks.xlsx"] as const).map((f) => (
                <button key={f} type="button" className="btn-ghost border border-ink-200 px-2 py-1 text-xs" onClick={() => void download(f)}>
                  <Download {...ICON_PROPS} />
                  {FILE_LABEL[f]}
                </button>
              ))}
            </div>
          </Hint>
          <button type="button" className="btn-ghost px-1.5" aria-label="Close review" onClick={props.onClose}>
            <X {...ICON_PROPS} />
          </button>
        </div>
      </div>
      {result.messages.length > 0 && <p className="px-1 text-[12px] text-ink-500">{result.messages.join(" ")}</p>}
      {error && <p className="px-1 text-[12px] text-danger-fg">{error}</p>}
      <p className="px-1 text-[12px] text-ink-500">Keys (click the table first): ↑/↓ move · A approve · R reject · Enter show the spectrum</p>
      <div className="max-h-[420px] overflow-auto rounded-md border border-ink-200">
        <table
          className="w-full border-collapse text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          role="grid"
          aria-label="Pipeline labels"
          tabIndex={0}
          onKeyDown={onKey}
        >
          <thead className="sticky top-0 bg-ink-50 text-left text-ink-600">
            <tr>
              <th className="px-2 py-1.5 font-medium">Peak</th>
              <th className="px-2 py-1.5 font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">Label</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
              <th className="px-2 py-1.5 font-medium">Reasons</th>
              <th className="px-2 py-1.5 font-medium">Series support</th>
              <th className="px-2 py-1.5 font-medium">Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lab, index) => {
              const peak = peakById.get(lab.peak_id);
              return (
                <tr
                  key={lab.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(lab.id, el);
                    else rowRefs.current.delete(lab.id);
                  }}
                  aria-selected={index === cursor}
                  className={clsx(
                    "cursor-pointer border-t border-ink-100 align-top hover:bg-ink-50",
                    lab.review === "rejected" && "opacity-50",
                    index === cursor && "bg-brand-50",
                  )}
                  onClick={() => {
                    setCursor(index);
                    if (peak) props.onJump(peak);
                  }}
                  title="Show this peak's spectrum"
                >
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                    {lab.peak_id} · {peak ? peak.rt_min.toFixed(2) : "–"}
                  </td>
                  <td className="px-2 py-1.5">{lab.rank}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium text-ink-900">{lab.text}</div>
                    <div className="text-ink-500">
                      m/z {lab.mz.toFixed(2)} · Δ {lab.abs_err_da.toFixed(2)} · {(lab.rel_intensity * 100).toFixed(1)}%
                      {lab.layout?.callout ? ` · callout ${lab.layout.callout}` : ""}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={clsx("rounded px-1.5 py-0.5 font-medium", STATUS_STYLE[lab.status])}>{lab.status}</span>
                  </td>
                  <td className="px-2 py-1.5 text-ink-600">{lab.reasons.length ? lab.reasons.join("; ") : "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {Math.round(lab.series_support * 100)}%
                    {lab.support_members.length > 0 && <span className="text-ink-500"> (DP {lab.support_members.join(", ")})</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <Hint id="lcms.pipeline.review">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          aria-label={`Approve ${lab.text}`}
                          aria-pressed={lab.review === "approved"}
                          disabled={busy === lab.id}
                          className={clsx("rounded border px-1.5 py-0.5", lab.review === "approved" ? "border-success bg-success text-on-brand" : "border-ink-200")}
                          onClick={() => void review(lab, "approved")}
                        >
                          <Check size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Reject ${lab.text}`}
                          aria-pressed={lab.review === "rejected"}
                          disabled={busy === lab.id}
                          className={clsx("rounded border px-1.5 py-0.5", lab.review === "rejected" ? "border-danger bg-danger text-on-brand" : "border-ink-200")}
                          onClick={() => void review(lab, "rejected")}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </Hint>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-center text-ink-500">
                  Nothing to show with this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
