import type { HelpModule } from "../types";
import { DocCode, DocH4, DocLead, DocLi, DocNote, DocOl, DocP, DocUl } from "../docPrimitives";

export const plateReaderHelpModule: HelpModule = {
  title: "Plate Reader — help",
  topics: [
    {
      id: "overview",
      title: "Overview",
      keywords: ["mic", "plate", "excel"],
      body: (
        <DocLead>
          Plate Reader mode loads a spreadsheet describing a 96-well style plate, lets you mark sample/control/blank
          rows, choose concentration columns, and run a MIC (minimum inhibitory concentration) style analysis with
          plots and exports.
        </DocLead>
      ),
    },
    {
      id: "files-workspace",
      title: "Files and workspace",
      keywords: ["xlsx", "csv", "workspace", "json"],
      body: (
        <>
          <DocUl>
            <DocLi>
              <strong>Open plate…</strong> accepts <DocCode>.xlsx .xlsm .xls .csv .tsv .txt</DocCode>.
            </DocLi>
            <DocLi>
              <strong>Load workspace</strong> reads <DocCode>.json</DocCode> or{" "}
              <DocCode>.plate_reader.workspace.json</DocCode> bundles.
            </DocLi>
            <DocLi>
              <strong>Save workspace</strong> writes the current sessions and wizard state.
            </DocLi>
            <DocLi>
              <strong>Clear</strong> removes all sessions after confirmation.
            </DocLi>
          </DocUl>
          <DocNote>
            <strong>Rename session</strong> uses the browser <DocCode>window.prompt</DocCode>;{" "}
            <strong>Clear</strong> uses <DocCode>window.confirm</DocCode>—these are native dialogs, not in-app modals.
          </DocNote>
        </>
      ),
    },
    {
      id: "sessions-sidebar",
      title: "Sessions sidebar",
      keywords: ["session", "rename", "remove"],
      body: (
        <DocP>
          Switch active plate session, rename via prompt, or remove a single session. When multiple sessions exist, only
          one is active at a time for the wizard and plot.
        </DocP>
      ),
    },
    {
      id: "load-preview",
      title: "Load card and plate preview",
      keywords: ["sheet", "header", "row", "S", "C", "B"],
      body: (
        <>
          <DocH4>Load options</DocH4>
          <DocUl>
            <DocLi>Pick worksheet (Excel) or rely on first sheet.</DocLi>
            <DocLi>
              <strong>Header row</strong> checkbox controls whether row 1 is treated as labels when inferring columns.
            </DocLi>
          </DocUl>
          <DocH4>Preview table</DocH4>
          <DocP>
            Each row can be tagged as <DocCode>S</DocCode> sample, <DocCode>C</DocCode> control, or <DocCode>B</DocCode>{" "}
            blank. Concentration columns are selected for MIC curve construction. Invalid or empty cells may be flagged
            in summaries.
          </DocP>
        </>
      ),
    },
    {
      id: "mic-wizard",
      title: "MIC wizard",
      keywords: ["wizard", "run", "concentration", "plot"],
      body: (
        <>
          <DocP>
            Configure replicate counts, concentration axis options, tick marks, plot type (e.g. line vs point styles),
            control line styling, and run the MIC calculation. The backend returns fitted/summary objects consumed by the
            chart card.
          </DocP>
          <DocOl>
            <DocLi>Load plate → verify preview marks match the physical plate layout.</DocLi>
            <DocLi>Select concentration source columns per layout conventions.</DocLi>
            <DocLi>Adjust plot options for publication (size, colors).</DocLi>
            <DocLi>Run analysis; review the “MIC Analysis Complete” summary card.</DocLi>
          </DocOl>
        </>
      ),
    },
    {
      id: "chart-controls",
      title: "MIC chart controls (after run)",
      keywords: ["legend", "grid", "color", "export"],
      body: (
        <>
          <DocP>
            After MIC completes, the chart card exposes styling: sample/control/blank colors, line width, marker size, bar
            width, plot height, grid, and legend visibility. Exports include MIC table CSV/JSON and Plotly PNG/SVG
            snapshots of the current figure.
          </DocP>
        </>
      ),
    },
    {
      id: "chart-exports",
      title: "Chart and exports",
      keywords: ["png", "svg", "csv", "json", "plotly"],
      body: (
        <>
          <DocUl>
            <DocLi>Plotly chart supports MIC curve visualization with theme-aware colors.</DocLi>
            <DocLi>
              <strong>Export CSV / JSON</strong> downloads structured results for spreadsheets or pipelines.
            </DocLi>
            <DocLi>
              <strong>Export PNG / SVG</strong> uses Plotly <DocCode>downloadImage</DocCode> with configured dimensions.
            </DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      keywords: ["error", "parse"],
      body: (
        <DocUl>
          <DocLi>Wrong columns: revisit header-row setting and sheet selection.</DocLi>
          <DocLi>Run button disabled: ensure required rows/columns are assigned.</DocLi>
          <DocLi>Plot empty: confirm analysis finished without errors in the banner.</DocLi>
        </DocUl>
      ),
    },
  ],
};
