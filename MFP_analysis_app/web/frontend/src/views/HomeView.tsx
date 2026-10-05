import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChartLine, Compass, FileUp, Wand2, FlaskConical, Grid3X3, MessageSquare, MousePointerClick, Search } from "lucide-react";
import { api } from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";
import { TryExampleButton } from "../components/ExampleData";
import { ICON_PROPS } from "../components/common/ChartCardParts";
import { useStoredState } from "../hooks/useStoredState";
import { useWorkspace } from "../context/WorkspaceContext";
import { OPEN_ON_KEY, type OpenOn } from "../layout/startPage";
import { useTour } from "../help/TourProvider";
import { tourForTab } from "../help/tours";
import { tabOfRoute } from "../help/controls";
import { useWorkflow, type WorkflowId } from "../workflows/WorkflowProvider";

interface OpenFile {
  id: string;
  name: string;
}

interface Task {
  route: string;
  module?: "lcms" | "ftir" | "plate_reader";
  workflow?: WorkflowId;
  icon: ReactNode;
  title: string;
  text: string;
  open: string;
}

const TASKS: Task[] = [
  {
    route: "/plate-reader",
    module: "plate_reader",
    workflow: "mic-plate",
    icon: <Grid3X3 size={22} strokeWidth={1.6} aria-hidden />,
    title: "Analyse a MIC plate",
    text: "Lay out a Gen5 plate (compounds, growth control, blank) and read % growth, dose–response and the MIC.",
    open: "Open Plate Reader",
  },
  {
    route: "/lcms",
    module: "lcms",
    workflow: "lcms-product",
    icon: <ChartLine size={22} strokeWidth={1.6} aria-hidden />,
    title: "Find my product in an LCMS run",
    text: "Open an mzML run, follow masses with EICs and label polymer series and expected products.",
    open: "Open LCMS",
  },
  {
    route: "/ftir",
    module: "ftir",
    icon: <FlaskConical size={22} strokeWidth={1.6} aria-hidden />,
    title: "Identify FTIR peaks",
    text: "Clean up a spectrum, pick peaks and see which functional groups the bond library suggests.",
    open: "Open FTIR",
  },
  {
    route: "/ai",
    icon: <MessageSquare size={22} strokeWidth={1.6} aria-hidden />,
    title: "Ask the AI assistant",
    text: "Ask about your open data or the app, or let it run steps for you (it asks before anything risky).",
    open: "Open AI Assistant",
  },
];

function useOpenFiles(): Record<string, OpenFile[]> {
  const { activeWorkspaceId } = useWorkspace();
  const [files, setFiles] = useState<Record<string, OpenFile[]>>({});
  useEffect(() => {
    let cancelled = false;
    const take = <T,>(p: Promise<T[]>, map: (x: T) => OpenFile) => p.then((list) => list.map(map)).catch(() => []);
    Promise.all([
      take(api.plateReader.list(), (s) => ({ id: s.session_id, name: s.display_name })),
      take(api.lcms.list(), (s) => ({ id: s.session_id, name: s.display_name })),
      take(api.ftir.list(), (s) => ({ id: s.session_id, name: s.display_name })),
    ]).then(([plates, lcms, ftir]) => {
      if (!cancelled) setFiles({ "/plate-reader": plates, "/lcms": lcms, "/ftir": ftir });
    });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);
  return files;
}

function TaskCard({ task, files }: { task: Task; files: OpenFile[] | undefined }) {
  const navigate = useNavigate();
  const { startTour } = useTour();
  const { startWorkflow } = useWorkflow();
  const tour = tourForTab(tabOfRoute(task.route));
  const recent = (files ?? []).slice(-3).reverse();
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          {task.icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-card-title">{task.title}</h2>
          <p className="mt-1 text-sm text-ink-600">{task.text}</p>
        </div>
      </div>
      {recent.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-caption">
            {files?.length} file{files?.length === 1 ? "" : "s"} open — continue with:
          </div>
          {recent.map((f) => (
            <button
              key={f.id}
              type="button"
              className="truncate rounded-md px-2 py-1 text-left text-[13px] text-ink-800 hover:bg-ink-100"
              title={f.name}
              onClick={() => navigate(`${task.route}?open=${encodeURIComponent(f.id)}`)}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        {task.workflow && (
          <button type="button" className="btn-primary" onClick={() => startWorkflow({ id: task.workflow as WorkflowId })}>
            <Wand2 {...ICON_PROPS} />
            Guide me
          </button>
        )}
        <button
          type="button"
          className={task.workflow ? "btn-ghost border border-ink-200" : "btn-primary"}
          onClick={() => navigate(task.route)}
        >
          {task.open}
        </button>
        {task.module && (
          <TryExampleButton
            module={task.module}
            onOpened={(ids) => navigate(ids[0] ? `${task.route}?open=${encodeURIComponent(ids[0])}` : task.route)}
          />
        )}
        {tour && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              navigate(task.route);
              startTour(tour.id);
            }}
          >
            <Compass {...ICON_PROPS} />
            Take the tour
          </button>
        )}
      </div>
    </div>
  );
}

function Tip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-ink-700">
      <span className="mt-0.5 text-ink-500">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

export function HomeView() {
  const files = useOpenFiles();
  const [openOn, setOpenOn] = useStoredState<OpenOn>(OPEN_ON_KEY, "home");

  usePageHeader(<PageHeaderContent title="Home" subtitle="What do you want to do?" />);

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {TASKS.map((task) => (
            <TaskCard key={task.route} task={task} files={files[task.route]} />
          ))}
        </div>
        <div className="card flex flex-col gap-3 p-5">
          <h2 className="text-card-title">Getting around</h2>
          <ul className="flex flex-col gap-2">
            <Tip icon={<Search {...ICON_PROPS} />}>
              Can't find a button? Press <kbd className="kbd">Ctrl K</kbd> and type what you want to do, e.g.
              "exclude well" or "baseline".
            </Tip>
            <Tip icon={<MousePointerClick {...ICON_PROPS} />}>
              Hover any control for a short explanation and a typical value; press <kbd className="kbd">F1</kbd> on it
              for the full help.
            </Tip>
            <Tip icon={<FileUp {...ICON_PROPS} />}>
              Drop files anywhere in the window to open them in the right tab.
            </Tip>
          </ul>
        </div>
        <label className="flex items-center gap-2 self-end text-sm text-ink-600">
          When the app opens, show
          <select className="input py-1" value={openOn} onChange={(e) => setOpenOn(e.target.value as OpenOn)}>
            <option value="home">this Home page</option>
            <option value="last">the last tab I used</option>
          </select>
        </label>
      </div>
    </div>
  );
}
