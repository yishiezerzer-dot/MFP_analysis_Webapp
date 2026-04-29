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
  };
  export default Plotly;
}
