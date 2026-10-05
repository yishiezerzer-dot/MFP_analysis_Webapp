import { useEffect, useRef } from "react";

export type SessionModule = "lcms" | "ftir" | "plate_reader";

const EVENT = "mfp:sessions-changed";

// Workflows change sessions through the API; the tab showing them reloads its list.
export function notifySessionsChanged(module: SessionModule): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: module }));
}

export function useSessionsChanged(module: SessionModule, reload: () => void): void {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent<SessionModule>).detail === module) latest.current();
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [module]);
}
