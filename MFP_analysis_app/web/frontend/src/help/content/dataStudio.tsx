import type { HelpModule } from "../types";
import { DocCode, DocH4, DocLead, DocLi, DocOl, DocP, DocUl } from "../docPrimitives";

export const dataStudioHelpModule: HelpModule = {
  title: "Data Studio — help",
  topics: [
    {
      id: "overview",
      title: "Overview",
      keywords: ["table", "transform", "plot"],
      body: (
        <DocLead>
          Data Studio loads rectangular tables (CSV/TSV/TXT/Excel), previews parsed columns, lets you build a ordered
          transform pipeline, and charts selected columns with Plotly via <DocCode>ChartPanel</DocCode>.
        </DocLead>
      ),
    },
    {
      id: "open-table",
      title: "Opening a table",
      keywords: ["csv", "xlsx", "delimiter", "comma"],
      body: (
        <>
          <DocUl>
            <DocLi>
              Header action <strong>Open table…</strong> or empty-state <strong>Choose file…</strong> uses{" "}
              <DocCode>.csv .tsv .txt .xlsx .xlsm .xls</DocCode>.
            </DocLi>
            <DocLi>
              Parser options include sheet selection (Excel), header row flag, and decimal-comma handling for European CSVs.
            </DocLi>
            <DocLi>After load, the backend returns a schema listing column names and numeric/string hints.</DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "sessions-sidebar",
      title: "Sessions sidebar",
      keywords: ["session", "switch"],
      body: <DocP>Each opened file becomes a session; pick one active session for transforms and plotting.</DocP>,
    },
    {
      id: "load-card",
      title: "Load card",
      keywords: ["metadata", "shape", "warnings"],
      body: (
        <DocP>
          Shows file metadata, inferred shape, and warnings (e.g. coerced types). Changing load options may refetch schema
          and reset transforms because column names can change.
        </DocP>
      ),
    },
    {
      id: "preview-card",
      title: "Preview card",
      keywords: ["preview", "sample", "rows"],
      body: (
        <DocP>
          Displays the first rows after parsing and optional transforms (depending on pipeline state). Use it to confirm
          delimiter and decimal settings before heavy transforms.
        </DocP>
      ),
    },
    {
      id: "transform-pipeline",
      title: "Transform pipeline",
      keywords: ["transform", "undo", "pipeline"],
      body: (
        <>
          <DocH4>Building steps</DocH4>
          <DocP>
            Add transforms from the picker. Steps run top-to-bottom; each step sees the output of the previous one. The
            UI lists human-readable names; backend step kinds include:
          </DocP>
          <DocUl>
            <DocLi>
              <DocCode>select_columns</DocCode> — keep or drop columns by name.
            </DocLi>
            <DocLi>
              <DocCode>rename</DocCode> — rename columns using a mapping.
            </DocLi>
            <DocLi>
              <DocCode>to_numeric</DocCode> — coerce text columns to numbers (invalid cells may become NaN).
            </DocLi>
            <DocLi>
              <DocCode>fillna</DocCode> — fill missing values with a constant, mean, or forward-fill strategy.
            </DocLi>
            <DocLi>
              <DocCode>normalize</DocCode> — min–max [0,1] or z-score per column.
            </DocLi>
            <DocLi>
              <DocCode>baseline</DocCode> — subtract first point or rolling minimum baseline.
            </DocLi>
            <DocLi>
              <DocCode>log</DocCode> — log10 or natural log with optional offset to avoid log(0).
            </DocLi>
            <DocLi>
              <DocCode>rolling_mean</DocCode> — centered rolling average smoothing.
            </DocLi>
          </DocUl>
          <DocH4>Undo</DocH4>
          <DocP>
            Undo removes the last applied transform when history exists; warnings from the preview refresh display invalid
            combinations (e.g. missing columns after a rename).
          </DocP>
        </>
      ),
    },
    {
      id: "plot-controls",
      title: "Plot controls",
      keywords: ["scatter", "line", "bar", "histogram", "log", "normalize"],
      body: (
        <>
          <DocUl>
            <DocLi>
              <strong>Plot kind</strong> switches between line, scatter, bar, histogram, etc., subject to the column
              types you choose.
            </DocLi>
            <DocLi>
              <strong>X / Y columns</strong>: pick numeric columns for axes; multi-Y where supported.
            </DocLi>
            <DocLi>
              <strong>Normalization</strong> options adjust how Y (and X when applicable) are scaled before plotting.
            </DocLi>
            <DocLi>
              <strong>Log axes</strong> toggle logarithmic scaling; avoid log of non-positive values.
            </DocLi>
            <DocLi>
              <strong>Histogram bins</strong> controls bin count or width depending on UI mode.
            </DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "plot-chart",
      title: "Plot chart",
      keywords: ["plotly", "export"],
      body: (
        <DocP>
          The chart respects theme colors. Use Plotly mode bar exports when enabled in <DocCode>ChartPanel</DocCode>{" "}
          configuration.
        </DocP>
      ),
    },
    {
      id: "workflow-example",
      title: "Example workflow",
      keywords: ["tutorial"],
      body: (
        <DocOl>
          <DocLi>Open CSV → verify preview columns.</DocLi>
          <DocLi>Drop non-data rows with a filter transform.</DocLi>
          <DocLi>Sort by time or index column.</DocLi>
          <DocLi>Pick X vs Y and choose scatter or line plot.</DocLi>
          <DocLi>Toggle log-Y if spans orders of magnitude.</DocLi>
        </DocOl>
      ),
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      keywords: ["error", "empty"],
      body: (
        <DocUl>
          <DocLi>Schema empty: check header row and delimiter.</DocLi>
          <DocLi>Plot blank: selected columns may be non-numeric after transforms.</DocLi>
          <DocLi>Backend errors: confirm Data Studio router is reachable from <DocCode>api.ts</DocCode>.</DocLi>
        </DocUl>
      ),
    },
  ],
};
