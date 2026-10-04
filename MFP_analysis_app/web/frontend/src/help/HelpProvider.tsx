import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { HelpShell } from "./HelpShell";
import { getHelpModule } from "./registry";
import { flattenTopics } from "./topicUtils";
import { TAB_ROUTES, getControl, tabOfRoute, type ControlHint } from "./controls";
import { useShowControl } from "./useShowControl";

interface HelpContextValue {
  openHelp: (topicId?: string, route?: string) => void;
  setActiveHint: (id: string, active: boolean) => void;
  helpOpen: boolean;
}

const HelpContext = createContext<HelpContextValue>({ openHelp: () => {}, setActiveHint: () => {}, helpOpen: false });

export function useHelp() {
  return useContext(HelpContext);
}

export function helpTopicTitle(control: ControlHint): string | null {
  const route = TAB_ROUTES[control.tab];
  if (!control.helpTopic || !route) return null;
  const module = getHelpModule(route);
  return flattenTopics(module?.topics ?? []).find((t) => t.id === control.helpTopic)?.title ?? null;
}

// One help drawer for the whole app. F1 opens it at the topic of the control under the pointer
// (or with keyboard focus), else at the start of the current tab's help.
export function HelpProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [open, setOpen] = useState<{ route: string; topic?: string } | null>(null);
  const activeHint = useRef<string | null>(null);
  const showControl = useShowControl();

  const openHelp = useCallback(
    (topicId?: string, route?: string) => setOpen({ route: route ?? location.pathname, topic: topicId }),
    [location.pathname],
  );

  const setActiveHint = useCallback((id: string, active: boolean) => {
    if (active) activeHint.current = id;
    else if (activeHint.current === id) activeHint.current = null;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F1") return;
      e.preventDefault();
      const control = activeHint.current ? getControl(activeHint.current) : undefined;
      const route = control ? TAB_ROUTES[control.tab] ?? undefined : undefined;
      openHelp(control?.helpTopic, route);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openHelp]);

  const module = open ? getHelpModule(open.route) : null;
  const value = useMemo(() => ({ openHelp, setActiveHint, helpOpen: open !== null }), [openHelp, setActiveHint, open]);

  return (
    <HelpContext.Provider value={value}>
      {children}
      {module && (
        <HelpShell
          open
          module={module}
          initialTopic={open?.topic}
          tab={open ? tabOfRoute(open.route) : null}
          onShowControl={(id) => {
            setOpen(null);
            void showControl(id);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </HelpContext.Provider>
  );
}
