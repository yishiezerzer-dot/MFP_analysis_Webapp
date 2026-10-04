import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Grid3X3, X } from "lucide-react";
import { api, type PlateLayout, type PlateMetadata, type PlateSummary, type PlateTemplate, type PlateWell } from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";
import { HelpOpenButton } from "../help/HelpShell";
import { AlertBanner } from "../components/AlertBanner";
import { useToast } from "../components/Toast";
import { SideRail } from "../components/common/SideRail";
import { SegmentedControl } from "../components/common/SegmentedControl";
import { ICON_PROPS } from "../components/common/ChartCardParts";
import { Hint } from "../components/Hint";
import { useRevealPanel } from "../help/reveal";
import { ExperimentTagEditor } from "../components/ExperimentTagEditor";
import { BLANK_RING, GC_RING, PlateGrid } from "../components/plate/PlateGrid";
import { LayoutPanel, type SaveState } from "../components/plate/LayoutPanel";
import { ResultsTab } from "../components/plate/ResultsTab";
import { ExperimentTab } from "../components/plate/ExperimentTab";
import { useStoredState } from "../hooks/useStoredState";
import { useWorkspace } from "../context/WorkspaceContext";
import { useRegisterFileIngest } from "../context/FileIngestionContext";
import {
  buildLayout,
  DEFAULT_DILUTION,
  formFromLayout,
  formsEqual,
  layoutsEqual,
  paintWells,
  toggleExcluded,
  validateForm,
  withColours,
  type LayoutForm,
  type PaintTarget,
} from "../utils/plateLayout";

const STORAGE = "mfp.plateReader";
const SAVE_DELAY_MS = 400;

type PlateTab = "map" | "results" | "experiment";

function plateDate(meta: PlateMetadata): string | null {
  const d = meta.date;
  return typeof d === "string" ? d.slice(0, 10) : null;
}

function plateCaption(meta: PlateMetadata, label: string | null): string {
  const read = typeof meta.read_type === "string" ? meta.read_type.toLowerCase() : null;
  const wl = meta.wavelength ?? label;
  return [
    meta.reader_type,
    [read, wl && `${wl} nm`].filter(Boolean).join(" "),
    typeof meta.temperature === "number" && `${meta.temperature} °C`,
    plateDate(meta),
  ].filter(Boolean).join(" · ");
}

function emptyLayout(top: number): PlateLayout {
  return { dilution: { ...DEFAULT_DILUTION, top }, groups: [], growth_control: [], blank: [], excluded: [] };
}

export function PlateReaderView() {
  const { toast } = useToast();
  const { activeWorkspaceId } = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [plates, setPlates] = useState<PlateSummary[]>([]);
  const [activeSid, setActiveSid] = useStoredState<string | null>(`${STORAGE}.activeSid`, null);
  const [tab, setTab] = useStoredState<PlateTab>(`${STORAGE}.tab`, "map");
  const [lastTop, setLastTop] = useStoredState<number>(`${STORAGE}.lastTop`, DEFAULT_DILUTION.top);
  const [lastTemplateId, setLastTemplateId] = useStoredState<string | null>(`${STORAGE}.lastTemplate`, null);
  const [templates, setTemplates] = useState<PlateTemplate[]>([]);
  const [layout, setLayout] = useState<PlateLayout | null>(null);
  const [form, setForm] = useState<LayoutForm | null>(null);
  const [paint, setPaint] = useState<PaintTarget | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedCount, setSavedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingSave = useRef<{ sid: string; layout: PlateLayout; timer: number } | null>(null);

  const active = plates.find((p) => p.session_id === activeSid) ?? null;
  useRevealPanel({
    "plate.tab.map": () => setTab("map"),
    "plate.tab.results": () => setTab("results"),
    "plate.tab.experiment": () => setTab("experiment"),
  });
  const view: PlateTab = tab === "experiment" && !active?.experiment_tag ? "map" : tab;

  useEffect(() => {
    let cancelled = false;
    api.plateReader
      .list()
      .then((list) => {
        if (cancelled) return;
        setPlates(list);
        setActiveSid((sid) => (list.some((p) => p.session_id === sid) ? sid : list[0]?.session_id ?? null));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, setActiveSid]);

  useEffect(() => {
    api.plateReader.templates().then(setTemplates).catch((e) => setError(String(e)));
  }, []);

  const flushSave = useCallback(() => {
    const p = pendingSave.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pendingSave.current = null;
    setSaveState("saving");
    api.plateReader
      .saveLayout(p.sid, p.layout)
      .then(() => {
        setSaveState("saved");
        setSavedCount((n) => n + 1);
        setPlates((prev) =>
          prev.map((x) => (x.session_id === p.sid ? { ...x, layout: p.layout, layout_source: "saved" } : x)),
        );
      })
      .catch((e) => {
        setSaveState("error");
        toast(`Layout not saved: ${String(e)}`, "error");
      });
  }, [toast]);

  useEffect(() => flushSave, [flushSave]);

  const commitLayout = useCallback(
    (sid: string, next: PlateLayout, syncForm = true) => {
      setLayout(next);
      if (syncForm) setForm(formFromLayout(next));
      if (pendingSave.current) window.clearTimeout(pendingSave.current.timer);
      pendingSave.current = { sid, layout: next, timer: window.setTimeout(flushSave, SAVE_DELAY_MS) };
      setSaveState("saving");
    },
    [flushSave],
  );

  // Opening a plate: its saved layout, else the Gen5-notes layout (with the remembered top
  // concentration), else the last template used.
  const activeKey = active?.session_id ?? null;
  useEffect(() => {
    flushSave();
    setPaint(null);
    setSaveState("idle");
    if (!active) {
      setLayout(null);
      setForm(null);
      return;
    }
    const server = withColours(active.layout);
    let initial = server;
    if (active.layout_source === "notes") {
      initial = { ...server, dilution: { ...server.dilution, top: lastTop } };
    } else if (active.layout_source === "empty") {
      const t = templates.find((x) => x.id === lastTemplateId);
      initial = t ? withColours({ ...t.layout, excluded: [] }) : emptyLayout(lastTop);
    }
    if (layoutsEqual(initial, active.layout)) {
      setLayout(initial);
      setForm(formFromLayout(initial));
    } else {
      commitLayout(active.session_id, initial);
    }
    // Only when the plate changes; later edits go through commitLayout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const problems = useMemo(() => (form ? validateForm(form) : []), [form]);
  const dirty = useMemo(
    () => Boolean(form && layout && !formsEqual(form, formFromLayout(layout))),
    [form, layout],
  );

  const onUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    const added: PlateSummary[] = [];
    for (const file of files) {
      try {
        added.push(await api.plateReader.upload(file));
      } catch (e) {
        toast(String(e).replace(/^Error: HTTP \d+: /, ""), "error");
      }
    }
    if (added.length) {
      setPlates((prev) => [...prev, ...added]);
      setActiveSid(added[added.length - 1].session_id);
      setTab("map");
    }
    setBusy(false);
  };

  useRegisterFileIngest("/plate-reader", onUpload);

  const onRemove = async (sid: string) => {
    try {
      await api.plateReader.remove(sid);
    } catch (e) {
      setError(String(e));
      return;
    }
    const rest = plates.filter((p) => p.session_id !== sid);
    setPlates(rest);
    if (sid === activeSid) setActiveSid(rest[0]?.session_id ?? null);
  };

  const onApply = () => {
    if (!active || !form || !layout) return;
    setLastTop(form.dilution.top);
    commitLayout(active.session_id, buildLayout(form, layout.excluded));
  };

  const onToggleExcluded = useCallback(
    (well: PlateWell) => {
      if (active && layout) commitLayout(active.session_id, toggleExcluded(layout, well), false);
    },
    [active, layout, commitLayout],
  );

  const onPaint = useCallback(
    (wells: PlateWell[]) => {
      if (active && layout && paint) commitLayout(active.session_id, paintWells(layout, wells, paint));
    },
    [active, layout, paint, commitLayout],
  );

  const onLoadTemplate = (t: PlateTemplate) => {
    if (!active || !layout) return;
    setLastTemplateId(t.id);
    setLastTop(t.layout.dilution.top);
    commitLayout(active.session_id, withColours({ ...t.layout, excluded: layout.excluded }));
  };

  const onSaveTemplate = async (name: string) => {
    if (!layout) return;
    try {
      const saved = await api.plateReader.saveTemplate(name, { ...layout, excluded: [] });
      setTemplates((prev) => [...prev.filter((t) => t.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setLastTemplateId(saved.id);
      toast(`Template "${saved.name}" saved`, "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const onDeleteTemplate = async (t: PlateTemplate) => {
    try {
      await api.plateReader.deleteTemplate(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      toast(`Template "${t.name}" deleted`, "info");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  usePageHeader(
    <PageHeaderContent
      title="Plate Reader"
      subtitle="MIC · plate maps, % growth, dose–response"
      actions={
        <>
          <HelpOpenButton />
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.xls,.csv,.txt,.tsv"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length > 0) void onUpload(files);
              e.target.value = "";
            }}
          />
          <Hint id="plate.open" placement="bottom">
            <button className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Opening…" : "Open plate…"}
            </button>
          </Hint>
        </>
      }
    />,
  );

  return (
    <div className="flex h-full flex-col">
      {error && (
        <AlertBanner kind="error" message={error} onDismiss={() => setError(null)} className="mx-6 mb-2 mt-2" />
      )}
      <div className="flex min-h-0 flex-1">
        <PlatesRail plates={plates} activeSid={activeSid} onSelect={setActiveSid} onRemove={onRemove} />
        {!active || !layout || !form ? (
          <div className="flex min-w-0 flex-1 flex-col overflow-auto p-6">
            <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
              <Grid3X3 size={40} strokeWidth={1.5} className="text-ink-500" aria-hidden />
              <div className="text-card-title">Open a plate</div>
              <div className="max-w-md text-sm text-ink-500">
                A BioTek Gen5 Excel export, or any sheet or CSV with an 8×12 block labelled A–H and 1–12. Notes
                typed under the plate in Gen5 (e.g. "A-C - compound") fill in the layout.
              </div>
              <button className="btn-primary mt-2" onClick={() => fileRef.current?.click()}>
                Choose file(s)…
              </button>
            </div>
          </div>
        ) : (
          <>
            <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
                <span className="text-card-title max-w-[28rem] truncate" title={active.display_name}>
                  {active.display_name}
                </span>
                <span className="text-caption">{plateCaption(active.metadata, active.label)}</span>
                <ExperimentTagEditor
                  sessionId={active.session_id}
                  currentTag={active.experiment_tag}
                  module="plate-reader"
                  onTagUpdated={(tag) =>
                    setPlates((prev) => prev.map((p) => (p.session_id === active.session_id ? { ...p, experiment_tag: tag } : p)))
                  }
                />
                <span className="flex-1" />
                <Hint id="plate.view">
                <SegmentedControl<PlateTab>
                  ariaLabel="Plate view"
                  size="md"
                  value={view}
                  onChange={setTab}
                  options={[
                    { value: "map", label: "Plate map" },
                    { value: "results", label: "Results" },
                    { value: "experiment", label: "Experiment", disabled: !active.experiment_tag, title: active.experiment_tag ? undefined : "Give plates the same experiment tag to combine them" },
                  ]}
                />
                </Hint>
              </div>
              {view === "map" ? (
                <PlateMapCard
                  plate={active}
                  layout={layout}
                  paint={paint}
                  onPaintTarget={setPaint}
                  onToggleExcluded={onToggleExcluded}
                  onPaint={onPaint}
                />
              ) : view === "results" ? (
                <ResultsTab plate={active} layout={layout} />
              ) : (
                <ExperimentTab tag={active.experiment_tag} refreshKey={savedCount} />
              )}
            </main>
            {view === "map" && (
              <LayoutPanel
                form={form}
                onFormChange={setForm}
                problems={problems}
                dirty={dirty}
                onApply={onApply}
                notes={active.notes}
                layoutSource={active.layout_source}
                templates={templates}
                onLoadTemplate={onLoadTemplate}
                onSaveTemplate={onSaveTemplate}
                onDeleteTemplate={onDeleteTemplate}
                saveState={saveState}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PlateMapCard({
  plate,
  layout,
  paint,
  onPaintTarget,
  onToggleExcluded,
  onPaint,
}: {
  plate: PlateSummary;
  layout: PlateLayout;
  paint: PaintTarget | null;
  onPaintTarget: (t: PaintTarget | null) => void;
  onToggleExcluded: (well: PlateWell) => void;
  onPaint: (wells: PlateWell[]) => void;
}) {
  const targets: { id: PaintTarget; label: string; ring: string | null; count: number }[] = [
    ...layout.groups.map((g) => ({ id: g.id, label: g.name, ring: g.colour || "#405a9c", count: g.wells.length })),
    { id: "growth_control", label: "Growth control", ring: GC_RING, count: layout.growth_control.length },
    { id: "blank", label: "Blank", ring: BLANK_RING, count: layout.blank.length },
    { id: "none", label: "Unassigned", ring: null, count: 0 },
  ];
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="overflow-x-auto">
        <PlateGrid
          values={plate.values}
          layout={layout}
          onToggleExcluded={onToggleExcluded}
          onPaint={paint ? onPaint : undefined}
        />
      </div>
      <Hint id="plate.paint" placement="bottom">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Paint wells as">
        {targets.map((t) => {
          const on = paint === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              title={on ? "Stop painting" : `Drag across wells to make them ${t.label}`}
              onClick={() => onPaintTarget(on ? null : t.id)}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                on ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 text-ink-700 hover:bg-ink-100",
              )}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={t.ring ? { boxShadow: `0 0 0 2px ${t.ring}` } : { border: "1px dashed rgb(var(--ink-400))" }}
                aria-hidden
              />
              {t.label}
              {t.count > 0 && <span className="text-ink-500">{t.count}</span>}
            </button>
          );
        })}
        <span className="inline-flex items-center gap-1.5 px-1 text-[12px] text-ink-700">
          <span className="plate-well-excluded h-2.5 w-2.5 rounded-full" aria-hidden />
          Excluded {layout.excluded.length > 0 && <span className="text-ink-500">({layout.excluded.join(", ")})</span>}
        </span>
      </div>
      </Hint>
      <Hint id="plate.grid">
      <p className="text-caption">
        {paint
          ? "Drag across wells to assign them · Esc cancels · click a well to exclude or include it"
          : "Click a well to exclude or include it · pick a group above, then drag across wells to move them"}
      </p>
      </Hint>
    </div>
  );
}

function PlatesRail({
  plates,
  activeSid,
  onSelect,
  onRemove,
}: {
  plates: PlateSummary[];
  activeSid: string | null;
  onSelect: (sid: string) => void;
  onRemove: (sid: string) => void;
}) {
  return (
    <SideRail
      label="Plates"
      rail={plates.map((p, idx) => (
        <button
          key={p.session_id}
          type="button"
          onClick={() => onSelect(p.session_id)}
          title={p.display_name}
          className={clsx(
            "flex h-7 w-8 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold transition-colors",
            p.session_id === activeSid
              ? "border-brand-500 bg-surface text-brand-700 shadow-card"
              : "border-transparent text-ink-500 hover:border-ink-200 hover:bg-surface",
          )}
        >
          {idx + 1}
        </button>
      ))}
    >
      {(close) => (
        <>
          {plates.length === 0 && <div className="text-caption px-2">No plates open.</div>}
          {plates.map((p) => {
            const isActive = p.session_id === activeSid;
            const sub = [p.metadata.plate_number, plateDate(p.metadata), p.label && `OD${p.label}`].filter(Boolean).join(" · ");
            return (
              <div
                key={p.session_id}
                className={clsx(
                  "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                  isActive ? "bg-surface shadow-card" : "hover:bg-ink-100",
                )}
                onClick={() => {
                  onSelect(p.session_id);
                  close();
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium" title={p.display_name}>
                    {p.display_name.replace(/\.(xlsx|xlsm|xls|csv|txt|tsv)$/i, "")}
                  </div>
                  {sub && <div className="text-caption truncate">{sub}</div>}
                  {p.experiment_tag && <div className="text-caption truncate">Experiment: {p.experiment_tag}</div>}
                </div>
                <button
                  type="button"
                  className="btn-ghost invisible px-1.5 py-0.5 group-hover:visible focus-visible:visible"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(p.session_id);
                  }}
                  aria-label={`Remove ${p.display_name}`}
                  title="Remove"
                >
                  <X {...ICON_PROPS} />
                </button>
              </div>
            );
          })}
        </>
      )}
    </SideRail>
  );
}
