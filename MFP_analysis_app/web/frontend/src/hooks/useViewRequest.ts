import { useEffect, useRef } from "react";

export type ViewModule = "lcms" | "ftir";

const EVENT = "mfp:view-request";
const pending = new Map<ViewModule, unknown>();

// A workflow hands its result to a tab that may not be mounted yet; the tab takes it once it is ready.
export function requestView<T>(module: ViewModule, request: T): void {
  pending.set(module, request);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: module }));
}

export function useViewRequest<T>(module: ViewModule, ready: boolean, apply: (request: T) => void): void {
  const latest = useRef(apply);
  latest.current = apply;
  useEffect(() => {
    if (!ready) return;
    const take = () => {
      if (!pending.has(module)) return;
      const request = pending.get(module) as T;
      pending.delete(module);
      latest.current(request);
    };
    take();
    const onRequest = (e: Event) => {
      if ((e as CustomEvent<ViewModule>).detail === module) take();
    };
    window.addEventListener(EVENT, onRequest);
    return () => window.removeEventListener(EVENT, onRequest);
  }, [module, ready]);
}
