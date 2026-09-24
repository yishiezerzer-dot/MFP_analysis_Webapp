import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { LCMSSessionSummary } from "../../api";
import { LCMSProject, LCMSActiveProjectId, formatUploaded, sessionTooltip, formatRange } from "../../lcms/viewShared";
import { COMPACT_LAYOUT_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";

export const SESSIONS_PIN_STORAGE_KEY = "mfp.lcms.sessions.pinned";

export function SessionsSidebar(props: {
  sessions: LCMSSessionSummary[];
  activeSid: string | null;
  projects: LCMSProject[];
  sessionProjectById: Record<string, string | null>;
  activeProjectId: LCMSActiveProjectId;
  onSelect: (sid: string) => void;
  onRemove: (sid: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
  onSelectProject: (projectId: LCMSActiveProjectId) => void;
}) {
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(SESSIONS_PIN_STORAGE_KEY);
    return stored === "1";
  });
  const [hovered, setHovered] = useState(false);
  const [openProjectId, setOpenProjectId] = useState<LCMSActiveProjectId>("__unassigned");
  const hideTimer = useRef<number | null>(null);
  // Laptops: a slim rail that opens over the charts (hover or click) instead of taking width.
  const compact = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverlayOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) setOverlayOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [overlayOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SESSIONS_PIN_STORAGE_KEY,
        pinned ? "1" : "0",
      );
    } catch {
      /* ignore (private mode / SSR) */
    }
  }, [pinned]);

  const expanded = compact ? hovered || overlayOpen : pinned || hovered || openProjectId !== "__all";
  const selectSession = (sid: string) => {
    props.onSelect(sid);
    setOverlayOpen(false);
  };
  const unassignedSessions = props.sessions.filter((session) => !props.sessionProjectById[session.session_id]);
  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, LCMSSessionSummary[]>();
    props.projects.forEach((project) => grouped.set(project.id, []));
    props.sessions.forEach((session) => {
      const projectId = props.sessionProjectById[session.session_id];
      if (projectId) grouped.get(projectId)?.push(session);
    });
    return grouped;
  }, [props.projects, props.sessionProjectById, props.sessions]);

  const toggleProjectOpen = (key: string) => {
    setOpenProjectId((prev) => (prev === key ? "__all" : key));
  };

  const handleDropSession = (event: DragEvent, projectId: string | null) => {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData("text/plain");
    if (sessionId) props.onMoveSession(sessionId, projectId);
  };

  // Debounce mouse-leave slightly so flicking across a scrollbar or
  // trailing-edge padding doesn't collapse the panel mid-click.
  const onEnter = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHovered(true);
  };
  const onLeave = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovered(false), 120);
  };
  useEffect(() => () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
  }, []);
  useEffect(() => {
    const available = new Set(["__all", "__unassigned", ...props.projects.map((project) => project.id)]);
    if (!available.has(openProjectId)) setOpenProjectId("__unassigned");
  }, [openProjectId, props.projects]);

  return (
    <div className={clsx("relative shrink-0 transition-[width] duration-200 ease-out", !compact && expanded ? "w-60" : "w-12")}>
    <aside
      ref={asideRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-expanded={expanded}
      aria-label="Sessions"
      className={clsx(
        "absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden border-r border-ink-200 bg-canvas text-ink-900",
        "transition-[width] duration-200 ease-out",
        expanded ? "w-60" : "w-12",
        compact && expanded && "shadow-lg",
      )}
    >
      <header
        className={clsx(
          "flex shrink-0 items-center gap-2 border-b border-ink-200/60 py-2",
          expanded ? "px-3" : "justify-center px-0",
        )}
      >
        {expanded ? (
          <>
            <span className="label flex-1 truncate">Sessions</span>
            <button
              type="button"
              onClick={props.onCreateProject}
              title="Create project"
              className="min-h-6 rounded-md border border-ink-200 bg-surface px-1.5 py-0.5 text-[12px] font-medium text-ink-700 hover:bg-ink-100"
            >
              + Project
            </button>
            <button
              type="button"
              onClick={() => setPinned((p) => !p)}
              title={
                pinned
                  ? "Unpin sessions panel (collapse when not hovered)"
                  : "Pin sessions panel (always open)"
              }
              aria-label={pinned ? "Unpin sessions panel" : "Pin sessions panel"}
              aria-pressed={pinned}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-200/60 hover:text-ink-800"
            >
              <IconPin pinned={pinned} className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          // Collapsed affordance: a stack icon that hints the panel holds a list
          // of items. Hovering the whole aside already expands it, so this is
          // purely a visual cue.
          <button
            type="button"
            className="btn-ghost px-1.5"
            title={compact ? "Open sessions" : "Pin sessions panel open"}
            aria-label={compact ? "Open sessions" : "Pin sessions panel open"}
            onClick={() => (compact ? setOverlayOpen(true) : setPinned(true))}
          >
            <IconStack className="h-4 w-4" />
          </button>
        )}
      </header>

      <div
        className={clsx(
          "flex flex-1 flex-col overflow-auto",
          expanded ? "gap-1 p-2" : "items-center gap-1 py-2",
        )}
      >
        {expanded && props.sessions.length === 0 && (
          <div className="px-2 text-xs text-ink-500">No files loaded.</div>
        )}

        {!expanded &&
          props.sessions.map((s, idx) => {
            const isActive = s.session_id === props.activeSid;
            return (
              <button
                key={s.session_id}
                type="button"
                onClick={() => selectSession(s.session_id)}
                title={s.display_name}
                className={clsx(
                  "flex h-7 w-8 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold transition-colors",
                  isActive
                    ? "border-brand-500 bg-surface text-brand-600 shadow-card"
                    : "border-transparent text-ink-500 hover:border-ink-200 hover:bg-surface",
                )}
              >
                {idx + 1}
              </button>
            );
          })}

        {expanded && props.sessions.length > 0 && (
          <>
            <button
              type="button"
              className={clsx(
                "rounded-md px-2 py-1 text-left text-xs font-semibold",
                props.activeProjectId === "__all"
                  ? "bg-brand-500/10 text-brand-700"
                  : "text-ink-600 hover:bg-ink-100",
              )}
              onClick={() => props.onSelectProject("__all")}
            >
              All <span className="font-mono text-[12px] text-ink-500">{props.sessions.length}</span>
            </button>
            <ProjectHeaderRow
              id="__unassigned"
              title="Unassigned"
              count={unassignedSessions.length}
              activeProjectId={props.activeProjectId}
              expanded={openProjectId === "__unassigned"}
              targetProjectId={null}
              builtin
              onToggle={() => toggleProjectOpen("__unassigned")}
              onSelectProject={() => props.onSelectProject("__unassigned")}
              onDropSession={handleDropSession}
            />
            {props.projects.map((project) => (
              <ProjectHeaderRow
                key={project.id}
                id={project.id}
                title={project.name}
                count={sessionsByProject.get(project.id)?.length ?? 0}
                activeProjectId={props.activeProjectId}
                expanded={openProjectId === project.id}
                targetProjectId={project.id}
                onToggle={() => toggleProjectOpen(project.id)}
                onSelectProject={() => props.onSelectProject(project.id)}
                onDeleteProject={() => props.onDeleteProject(project.id)}
                onDropSession={handleDropSession}
              />
            ))}
            <div className="mt-1 flex flex-col gap-1 border-t border-ink-200/70 pt-1">
              {openProjectId === "__unassigned" && (
                <ProjectSessionRows
                  sessions={unassignedSessions}
                  activeSid={props.activeSid}
                  projects={props.projects}
                  sessionProjectById={props.sessionProjectById}
                  onSelectSession={selectSession}
                  onRemoveSession={props.onRemove}
                  onMoveSession={props.onMoveSession}
                />
              )}
              {props.projects.map((project) =>
                openProjectId === project.id ? (
                  <ProjectSessionRows
                    key={project.id}
                    sessions={sessionsByProject.get(project.id) ?? []}
                    activeSid={props.activeSid}
                    projects={props.projects}
                    sessionProjectById={props.sessionProjectById}
                    onSelectSession={selectSession}
                    onRemoveSession={props.onRemove}
                    onMoveSession={props.onMoveSession}
                  />
                ) : null,
              )}
            </div>
          </>
        )}

        {false && props.sessions.map((s, idx) => {
          const isActive = s.session_id === props.activeSid;
          if (!expanded) {
            // Compact rail: small active-aware chip per session.
            return (
              <button
                key={s.session_id}
                type="button"
                onClick={() => props.onSelect(s.session_id)}
                title={s.display_name}
                className={clsx(
                  "flex h-7 w-8 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold transition-colors",
                  isActive
                    ? "border-brand-500 bg-surface text-brand-600 shadow-card"
                    : "border-transparent text-ink-500 hover:border-ink-200 hover:bg-surface",
                )}
              >
                {idx + 1}
              </button>
            );
          }
          return (
            <div
              key={s.session_id}
              className={clsx(
                "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                isActive ? "bg-surface shadow-card" : "hover:bg-ink-100",
              )}
              onClick={() => props.onSelect(s.session_id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.display_name}</div>
                <div className="text-[12px] text-ink-500">
                  {s.ms1_count} MS1 • {formatRange(s.rt_min, s.rt_max)} min
                  {s.uv?.available && " • UV"}
                </div>
              </div>
              <button
                className="invisible rounded px-1 text-xs text-ink-500 hover:bg-ink-200 hover:text-ink-900 group-hover:visible"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onRemove(s.session_id);
                }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </aside>
    </div>
  );
}

export function ProjectHeaderRow(props: {
  id: LCMSActiveProjectId;
  title: string;
  count: number;
  activeProjectId: LCMSActiveProjectId;
  expanded: boolean;
  targetProjectId: string | null;
  builtin?: boolean;
  onToggle: () => void;
  onSelectProject: () => void;
  onDeleteProject?: () => void;
  onDropSession: (event: DragEvent, projectId: string | null) => void;
}) {
  const isActiveProject = props.activeProjectId === props.id;
  return (
    <section
      className="rounded-md"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => props.onDropSession(event, props.targetProjectId)}
    >
      <div
        className={clsx(
          "flex items-center gap-1 rounded-md px-2 py-1 text-xs",
          isActiveProject ? "bg-brand-500/10 text-brand-700" : "text-ink-600 hover:bg-ink-100",
        )}
      >
        <button
          type="button"
          className="h-5 w-5 rounded text-[12px] hover:bg-ink-200/70"
          onClick={props.onToggle}
          aria-label={props.expanded ? "Collapse project" : "Expand project"}
        >
          {props.expanded ? "v" : ">"}
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-semibold"
          onClick={props.onSelectProject}
          title={props.title}
        >
          {props.title}
        </button>
        <span className="font-mono text-[12px] text-ink-500">{props.count}</span>
        {!props.builtin && props.onDeleteProject && (
          <button
            type="button"
            className="rounded px-1 text-[12px] text-ink-500 hover:bg-ink-200 hover:text-ink-800"
            onClick={props.onDeleteProject}
            title="Delete project"
          >
            x
          </button>
        )}
      </div>
    </section>
  );
}

export function ProjectSessionRows(props: {
  sessions: LCMSSessionSummary[];
  activeSid: string | null;
  projects: LCMSProject[];
  sessionProjectById: Record<string, string | null>;
  onSelectSession: (sid: string) => void;
  onRemoveSession: (sid: string) => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
}) {
  if (props.sessions.length === 0) {
    return <div className="px-2 py-1 text-[12px] text-ink-500">No files</div>;
  }

  return (
    <>
      {props.sessions.map((session) => {
        const isActive = session.session_id === props.activeSid;
        const currentProject = props.sessionProjectById[session.session_id] ?? "__unassigned";
        return (
          <div
            key={session.session_id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", session.session_id);
              event.dataTransfer.effectAllowed = "move";
            }}
            className={clsx(
              "group ml-3 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              isActive ? "bg-surface shadow-card" : "hover:bg-ink-100",
            )}
            onClick={() => props.onSelectSession(session.session_id)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" title={sessionTooltip(session)}>{session.display_name}</div>
              <div className="text-[12px] text-ink-500">
                {session.ms1_count} MS1 - {formatRange(session.rt_min, session.rt_max)} min
                {session.uv?.available && " - UV"}
                      {session.uploaded_at && ` - ${formatUploaded(session.uploaded_at)}`}
              </div>
            </div>
            <select
              className="max-w-[5.5rem] rounded border border-ink-200 bg-surface px-1 py-0.5 text-[12px] text-ink-600 opacity-0 transition-opacity group-hover:opacity-100"
              value={currentProject}
              title="Move to project"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                event.stopPropagation();
                props.onMoveSession(
                  session.session_id,
                  event.target.value === "__unassigned" ? null : event.target.value,
                );
              }}
            >
              <option value="__unassigned">Unassigned</option>
              {props.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button
              className="invisible rounded px-1 text-xs text-ink-500 hover:bg-ink-200 hover:text-ink-900 group-hover:visible"
              onClick={(event) => {
                event.stopPropagation();
                props.onRemoveSession(session.session_id);
              }}
              title="Remove"
            >
              x
            </button>
          </div>
        );
      })}
    </>
  );
}

export function ProjectSessionSection(props: {
  id: LCMSActiveProjectId;
  title: string;
  sessions: LCMSSessionSummary[];
  activeSid: string | null;
  activeProjectId: LCMSActiveProjectId;
  projects: LCMSProject[];
  sessionProjectById: Record<string, string | null>;
  expanded: boolean;
  targetProjectId: string | null;
  builtin?: boolean;
  onToggle: () => void;
  onSelectProject: () => void;
  onDeleteProject?: () => void;
  onSelectSession: (sid: string) => void;
  onRemoveSession: (sid: string) => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
  onDropSession: (event: DragEvent, projectId: string | null) => void;
}) {
  const isActiveProject = props.activeProjectId === props.id;
  return (
    <section
      className="rounded-md"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => props.onDropSession(event, props.targetProjectId)}
    >
      <div
        className={clsx(
          "flex items-center gap-1 rounded-md px-2 py-1 text-xs",
          isActiveProject ? "bg-brand-500/10 text-brand-700" : "text-ink-600 hover:bg-ink-100",
        )}
      >
        <button
          type="button"
          className="h-5 w-5 rounded text-[12px] hover:bg-ink-200/70"
          onClick={props.onToggle}
          aria-label={props.expanded ? "Collapse project" : "Expand project"}
        >
          {props.expanded ? "v" : ">"}
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-semibold"
          onClick={props.onSelectProject}
          title={props.title}
        >
          {props.title}
        </button>
        <span className="font-mono text-[12px] text-ink-500">{props.sessions.length}</span>
        {!props.builtin && props.onDeleteProject && (
          <button
            type="button"
            className="rounded px-1 text-[12px] text-ink-500 hover:bg-ink-200 hover:text-ink-800"
            onClick={props.onDeleteProject}
            title="Delete project"
          >
            x
          </button>
        )}
      </div>
      {props.expanded && (
        <div className="mt-1 flex flex-col gap-1 pl-3">
          {props.sessions.length === 0 ? (
            <div className="px-2 py-1 text-[12px] text-ink-500">No files</div>
          ) : (
            props.sessions.map((session) => {
              const isActive = session.session_id === props.activeSid;
              const currentProject = props.sessionProjectById[session.session_id] ?? "__unassigned";
              return (
                <div
                  key={session.session_id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", session.session_id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  className={clsx(
                    "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    isActive ? "bg-surface shadow-card" : "hover:bg-ink-100",
                  )}
                  onClick={() => props.onSelectSession(session.session_id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" title={sessionTooltip(session)}>{session.display_name}</div>
                    <div className="text-[12px] text-ink-500">
                      {session.ms1_count} MS1 - {formatRange(session.rt_min, session.rt_max)} min
                      {session.uv?.available && " - UV"}
                      {session.uploaded_at && ` - ${formatUploaded(session.uploaded_at)}`}
                    </div>
                  </div>
                  <select
                    className="max-w-[5.5rem] rounded border border-ink-200 bg-surface px-1 py-0.5 text-[12px] text-ink-600 opacity-0 transition-opacity group-hover:opacity-100"
                    value={currentProject}
                    title="Move to project"
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation();
                      props.onMoveSession(
                        session.session_id,
                        event.target.value === "__unassigned" ? null : event.target.value,
                      );
                    }}
                  >
                    <option value="__unassigned">Unassigned</option>
                    {props.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="invisible rounded px-1 text-xs text-ink-500 hover:bg-ink-200 hover:text-ink-900 group-hover:visible"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onRemoveSession(session.session_id);
                    }}
                    title="Remove"
                  >
                    x
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

export function IconStack({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

export function IconPin({
  pinned,
  className,
}: {
  pinned: boolean;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
  if (pinned) {
    return (
      <svg {...common}>
        <path d="M12 17v5" />
        <path
          d="M9 10.76a2 2 0 0 1 -1.11 1.79l-1.78 .9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1 -1v-.76a2 2 0 0 0 -1.11 -1.79l-1.78 -.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1 -1a2 2 0 0 0 0 -4H8a2 2 0 0 0 0 4a1 1 0 0 1 1 1z"
          fill="currentColor"
          fillOpacity={0.18}
        />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 17v5" />
      <path d="M15 9.34V7a1 1 0 0 1 1 -1a2 2 0 0 0 0 -4H7.89" />
      <path d="M9 9v1.76a2 2 0 0 1 -1.11 1.79l-1.78 .9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h9" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// --- Centre: dataset ribbon --------------------------------------------------
