declare module "plotly.js-dist-min" {
  import type { PlotlyHTMLElement } from "plotly.js";

  const Plotly: {
    Plots: {
      resize: (gd: PlotlyHTMLElement) => void | Promise<void>;
    };
    downloadImage: (
      gd: PlotlyHTMLElement,
      opts: Record<string, unknown>,
    ) => Promise<string>;
    newPlot: (
      gd: HTMLElement,
      data: unknown[],
      layout: Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => Promise<PlotlyHTMLElement>;
    purge: (gd: HTMLElement | PlotlyHTMLElement) => void;
  };
  export default Plotly;
}
