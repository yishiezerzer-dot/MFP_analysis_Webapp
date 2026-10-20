import { useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { api, type PipelineFile, type PipelineRunSummary } from "../../api";
import { downloadBlob } from "../../lcms/viewShared";
import { ICON_PROPS } from "../common/ChartCardParts";
import { Modal } from "./DialogControls";

const RETENTION_DAYS = 5;

function runTitle(run: PipelineRunSummary): string {
  return run.display_name || run.uv_filename || run.job_id;
}

export function PipelineRunsDialog(props: {
  onOpen: (jobId: string) => void;
  onDeleted: (jobId: string, fileClosed: boolean, sessionId: string | null) => void;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<PipelineRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    api.lcmsPipeline.list().then(setRuns, (err) => setError(String(err)));
  }, []);

  const remove = async (run: PipelineRunSummary) => {
    try {
      const res = await api.lcmsPipeline.deleteRun(run.job_id);
      setRuns((prev) => (prev ?? []).filter((r) => r.job_id !== run.job_id));
      props.onDeleted(run.job_id, res.file_closed, run.session_id);
    } catch (err) {
      setError(String(err).replace(/^Error: (HTTP \d+: )?/, ""));
    } finally {
      setConfirming(null);
    }
  };

  const download = async (run: PipelineRunSummary, file: PipelineFile) => {
    try {
      const stem = runTitle(run).replace(/\.[^.]+$/, "") || "lcms";
      downloadBlob(await api.lcmsPipeline.download(run.job_id, file), `${stem}_pipeline_${file}`);
    } catch (err) {
      setError(String(err).replace(/^Error: (HTTP \d+: )?/, ""));
    }
  };

  return (
    <Modal title="Past pipeline runs" onClose={props.onClose} width="max-w-2xl">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-caption">
          Runs are kept on the server and deleted automatically after {RETENTION_DAYS} days. Deleting a run also closes the
          LCMS file it uploaded itself; a run on a file you had opened leaves that file open.
        </p>
        {error && <p className="text-[12px] text-danger-fg">{error}</p>}
        {runs === null && !error && <p className="text-caption">Loading…</p>}
        {runs !== null && runs.length === 0 && <p className="text-caption">No pipeline runs yet.</p>}
        {runs !== null && runs.length > 0 && (
          <ul className="flex flex-col divide-y divide-ink-100 rounded-md border border-ink-200">
            {runs.map((run) => {
              const done = run.status === "done";
              return (
                <li key={run.job_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink-800">{runTitle(run)}</div>
                    <div className="text-caption">
                      {new Date(run.created_at).toLocaleString()} · {run.uv_filename || "UV"}
                      {done && run.n_peaks !== null ? ` · ${run.n_peaks} peaks · ${run.approved ?? 0} approved` : ` · ${run.status}`}
                      {done && !run.file_open ? " · file closed" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {confirming === run.job_id ? (
                      <>
                        <span className="text-[12px] text-ink-600">Delete this run?</span>
                        <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={() => void remove(run)}>
                          Yes, delete
                        </button>
                        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setConfirming(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn-ghost border border-ink-200 px-2 py-1 text-xs"
                          disabled={!done || !run.file_open}
                          title={done && !run.file_open ? "Its LCMS file was closed; the figure and workbook can still be downloaded." : undefined}
                          onClick={() => props.onOpen(run.job_id)}
                        >
                          Open review
                        </button>
                        {done && (
                          <>
                            <button type="button" className="btn-ghost px-1.5 py-1 text-xs" aria-label={`Download figure of ${runTitle(run)}`} onClick={() => void download(run, "figure.png")}>
                              <Download {...ICON_PROPS} />
                              PNG
                            </button>
                            <button type="button" className="btn-ghost px-1.5 py-1 text-xs" aria-label={`Download workbook of ${runTitle(run)}`} onClick={() => void download(run, "peaks.xlsx")}>
                              <Download {...ICON_PROPS} />
                              xlsx
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="btn-ghost px-1.5 py-1 text-xs"
                          aria-label={`Delete run ${runTitle(run)}`}
                          disabled={run.status === "queued" || run.status === "running"}
                          onClick={() => setConfirming(run.job_id)}
                        >
                          <Trash2 {...ICON_PROPS} />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
