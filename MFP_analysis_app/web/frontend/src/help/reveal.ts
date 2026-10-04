import { useEffect, useRef } from "react";
import { getControl } from "./controls";

// Views register how to open their panels (an inspector section, a tools tab, a Plate Reader tab),
// so the finder, tours and "Show me" can reveal a control that is currently hidden.
type PanelHandlers = Record<string, () => void>;

const handlers = new Map<string, () => void>();

export function useRevealPanel(panelHandlers: PanelHandlers): void {
  const latest = useRef(panelHandlers);
  latest.current = panelHandlers;
  const keys = Object.keys(panelHandlers).sort().join("|");
  useEffect(() => {
    const names = keys ? keys.split("|") : [];
    for (const name of names) handlers.set(name, () => latest.current[name]?.());
    return () => {
      for (const name of names) handlers.delete(name);
    };
  }, [keys]);
}

export function hasPanelHandler(name: string): boolean {
  return handlers.has(name);
}

// Next frame, or 50 ms when the browser pauses frames (background or hidden tab).
const frame = () =>
  new Promise<void>((r) => {
    const done = () => r();
    requestAnimationFrame(done);
    window.setTimeout(done, 50);
  });

async function waitFor<T>(get: () => T | null | undefined, timeoutMs: number): Promise<T | null> {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const value = get();
    if (value) return value;
    if (performance.now() > end) return null;
    await frame();
  }
}

// An attribute, not a class: React rewrites className on re-render and would drop the flash.
export const FLASH_ATTR = "data-flash";
const FLASH_MS = 1600;

export type RevealResult = "shown" | "not-found";

// Opens the control's panel (once the view that owns it is mounted), scrolls it into view,
// flashes an outline and focuses it.
export async function revealControl(
  id: string,
  timeoutMs = 2000,
  { highlight = true }: { highlight?: boolean } = {},
): Promise<RevealResult> {
  const control = getControl(id);
  const panel = control?.panel;
  if (panel) {
    const open = await waitFor(() => handlers.get(panel), timeoutMs);
    open?.();
    await frame();
    await frame();
  }
  const el = await waitFor(() => document.querySelector<HTMLElement>(`[data-control="${id}"]`), timeoutMs);
  if (!el) return "not-found";
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  if (!highlight) return "shown";
  el.removeAttribute(FLASH_ATTR);
  void el.offsetWidth; // restart the animation when the same control is revealed twice
  el.setAttribute(FLASH_ATTR, "");
  window.setTimeout(() => el.removeAttribute(FLASH_ATTR), FLASH_MS);
  const focusable = el.matches("button, input, select, textarea, a[href]")
    ? el
    : el.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, a[href]");
  focusable?.focus({ preventScroll: true });
  return "shown";
}
