import { DependencyList, useEffect, useRef, useState } from "react";
import type { PlotlyHTMLElement } from "plotly.js";

let pendingPlotResizeFrame: number | null = null;

export function schedulePlotResize() {
  if (typeof window === "undefined" || pendingPlotResizeFrame !== null) return;
  pendingPlotResizeFrame = window.requestAnimationFrame(() => {
    pendingPlotResizeFrame = null;
    window.dispatchEvent(new Event("resize"));
  });
}

export function useContainerSize(
  ref: React.RefObject<HTMLDivElement>,
  fallbackHeight = 300,
): { height: number; width?: number; revision: number } {
  const [size, setSize] = useState<{ height: number; width?: number; revision: number }>({
    height: fallbackHeight,
    revision: 0,
  });
  const sizeRef = useRef<{ height: number; width?: number; revision: number }>({
    height: fallbackHeight,
    revision: 0,
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const animationFrames = new Set<number>();
    const timers = new Set<number>();
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const h = Math.floor(rect.height);
      const w = Math.floor(rect.width);
      const height = h > 0 ? h : sizeRef.current.height;
      const width = w > 0 ? w : sizeRef.current.width;
      if (height === sizeRef.current.height && width === sizeRef.current.width) return;
      const next = { height, width, revision: sizeRef.current.revision + 1 };
      sizeRef.current = next;
      setSize(next);
      schedulePlotResize();
    };
    const queueMeasure = () => {
      const frame = window.requestAnimationFrame(() => {
        animationFrames.delete(frame);
        measure();
      });
      animationFrames.add(frame);
    };
    const queueSeveralMeasures = () => {
      queueMeasure();
      [80, 240].forEach((delay) => {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          queueMeasure();
        }, delay);
        timers.add(timer);
      });
    };
    const ro = new ResizeObserver(() => {
      queueMeasure();
    });
    const onTrustedWindowResize = (event: Event) => {
      if (!event.isTrusted) return;
      queueMeasure();
    };
    const onVisibilityOrFocus = () => {
      queueSeveralMeasures();
    };
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") queueMeasure();
    }, 300);
    window.addEventListener("resize", onTrustedWindowResize);
    window.addEventListener("orientationchange", onTrustedWindowResize);
    window.addEventListener("focus", onVisibilityOrFocus);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.visualViewport?.addEventListener("resize", onVisibilityOrFocus);
    queueSeveralMeasures();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onTrustedWindowResize);
      window.removeEventListener("orientationchange", onTrustedWindowResize);
      window.removeEventListener("focus", onVisibilityOrFocus);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.visualViewport?.removeEventListener("resize", onVisibilityOrFocus);
      animationFrames.forEach((frame) => window.cancelAnimationFrame(frame));
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearInterval(pollTimer);
    };
  }, [ref, fallbackHeight]);
  return size;
}

export function usePlotResizePulses(
  deps: DependencyList,
  plotRef?: { current: PlotlyHTMLElement | null },
) {
  useEffect(() => {
    const resizeNow = () => {
      schedulePlotResize();
      if (!plotRef?.current) return;
      resizePlotlyElement(plotRef.current);
    };
    resizeNow();
    const timers = [0, 80, 240, 500].map((delay) => window.setTimeout(resizeNow, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export function resizePlotlyElement(graphDiv: PlotlyHTMLElement | null) {
  if (!graphDiv) return;
  void import("plotly.js-dist-min").then((plotlyModule) => {
    void plotlyModule.default.Plots.resize(graphDiv);
  });
}

export function queuePlotlyElementResize(graphDiv: PlotlyHTMLElement | null) {
  resizePlotlyElement(graphDiv);
  [0, 80, 240, 500].forEach((delay) => {
    window.setTimeout(() => resizePlotlyElement(graphDiv), delay);
  });
}

export function axisTitle(text: string, size: number) {
  return {
    text,
    font: { size, family: "Inter, -apple-system, sans-serif", color: "#46536a" },
    standoff: 10,
  };
}
