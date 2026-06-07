import type { HelpModule } from "../types";
import { DocCode, DocH4, DocLead, DocLi, DocNote, DocOl, DocP, DocUl } from "../docPrimitives";

export const ftirHelpModule: HelpModule = {
  title: "FTIR — help",
  topics: [
    {
      id: "overview",
      title: "Overview",
      keywords: ["ftir", "spectrum", "infrared"],
      body: (
        <>
          <DocLead>
            FTIR mode loads one spectrum per session (CSV/TXT/TSV/JCAMP DX/JDX/SPC), lets you preprocess (baseline,
            normalize, smoothing), pick peaks, assign peaks to a reference library, optionally integrate regions, and
            export results.
          </DocLead>
          <DocP>
            API calls are typed in <DocCode>src/api.ts</DocCode>; router modules live under{" "}
            <DocCode>web/backend/app/routers/ftir.py</DocCode> with services in <DocCode>ftir_service.py</DocCode>.
          </DocP>
        </>
      ),
    },
    {
      id: "files-workspace",
      title: "Files and workspace",
      keywords: ["upload", "json", "workspace"],
      body: (
        <>
          <DocUl>
            <DocLi>
              <strong>Open…</strong> accepts one or more files: <DocCode>.csv .txt .tsv .dx .jdx .spc</DocCode>.
            </DocLi>
            <DocLi>
              <strong>Load / Save workspace</strong> round-trips JSON with sessions and UI state.
            </DocLi>
            <DocLi>
              <strong>Export peaks CSV</strong> requires picked peaks first.
            </DocLi>
            <DocLi>
              Additional exports: JDX and HTML report (see header when enabled).
            </DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "sessions-sidebar",
      title: "Sessions sidebar",
      keywords: ["session", "switch", "remove"],
      body: (
        <DocP>Lists loaded FTIR sessions; select active, remove unwanted sessions, and keep one spectrum in focus.</DocP>
      ),
    },
    {
      id: "summary-card",
      title: "Session summary",
      keywords: ["metadata", "filename"],
      body: <DocP>Shows filename, point count, wavenumber span, and preprocessing mode after load.</DocP>,
    },
    {
      id: "peak-pick",
      title: "Peak picking and assignments",
      keywords: ["peak", "prominence", "derivative", "assign"],
      body: (
        <>
          <DocH4>Detection</DocH4>
          <DocUl>
            <DocLi>
              <strong>Min prominence</strong> filters small ripples; increase if you get too many peaks.
            </DocLi>
            <DocLi>
              <strong>Min height</strong> (optional) enforces an absolute Y cutoff after preprocessing.
            </DocLi>
            <DocLi>
              <strong>Min distance (cm⁻¹)</strong> prevents duplicate picks on the same band.
            </DocLi>
            <DocLi>
              <strong>Top N</strong> caps how many peaks are returned.
            </DocLi>
            <DocLi>
              <strong>Second derivative / shoulder mode</strong> uses 2nd-derivative minima to catch overlapping features.
            </DocLi>
          </DocUl>
          <DocH4>Library assignment</DocH4>
          <DocUl>
            <DocLi>
              <strong>Assign bonds</strong> toggles library matching with the bundled reference library.
            </DocLi>
            <DocLi>
              <strong>Assign top N</strong> stores multiple candidate hits per peak when enabled.
            </DocLi>
            <DocLi>
              <strong>Assign min score</strong> drops weak assignments below the threshold (0–100 scale in UI).
            </DocLi>
          </DocUl>
          <DocH4>Manual edit</DocH4>
          <DocP>
            Modes <DocCode>none</DocCode> / <DocCode>add</DocCode> / <DocCode>remove</DocCode> let you click the chart to
            add or remove peaks; clear resets manual additions.
          </DocP>
        </>
      ),
    },
    {
      id: "reprocess",
      title: "Reprocess panel",
      keywords: ["baseline", "normalize", "smooth", "atr", "preset"],
      body: (
        <>
          <DocH4>Modes and presets</DocH4>
          <DocP>
            Preprocessing options include absorbance/transmittance, Savitzky–Golay smoothing window, polynomial order,
            baseline algorithms (ASLS, airPLS, rubberband, etc.), normalization (max, vector, SNV), atmospheric masking,
            and ATR correction with crystal index. Built-in presets (KBr disc, ATR sample, …) fill sensible defaults.
          </DocP>
          <DocH4>Apply</DocH4>
          <DocP>
            Reprocess sends current options to the backend and replaces the displayed spectrum; watch the busy state if
            files are large.
          </DocP>
        </>
      ),
    },
    {
      id: "overlay",
      title: "Overlay panel",
      keywords: ["overlay", "compare"],
      body: (
        <DocP>
          Load additional spectra as overlays for visual comparison; colors distinguish traces. Remove overlays from the
          list when no longer needed.
        </DocP>
      ),
    },
    {
      id: "assignments",
      title: "Assignments panel",
      keywords: ["library", "match", "score"],
      body: (
        <>
          <DocP>
            After peak picking with “assign” enabled (or manual assignment actions), peaks receive candidate library hits
            with scores. Controls typically include top-N candidates and minimum score thresholds.
          </DocP>
          <DocNote>
            Exact assignment scoring follows backend FTIR library matching; see <DocCode>ftir_service.py</DocCode> and
            related library JSON for details when documenting score semantics for your deployment.
          </DocNote>
        </>
      ),
    },
    {
      id: "constraints-quant",
      title: "Constraints and quant / tools",
      keywords: ["integration", "fit", "subtract"],
      body: (
        <DocP>
          Collapsible sections cover quantitative tools (integration bands, fits, subtract reference) as exposed in the
          UI. Each action calls a dedicated backend endpoint; errors surface in the alert banner.
        </DocP>
      ),
    },
    {
      id: "spectrum-chart",
      title: "Spectrum chart",
      keywords: ["plotly", "zoom", "export", "svg", "png"],
      body: (
        <>
          <DocUl>
            <DocLi>Plotly interactions: pan, zoom, hover readouts in wavenumber and Y units after preprocessing.</DocLi>
            <DocLi>
              Graph settings (inline card) adjust colors, line width, axis titles, wavenumber range, frame style, and
              peak label colors.
            </DocLi>
            <DocLi>
              <strong>Export SVG / PNG</strong> exports the on-screen chart quickly. For manuscripts, use{" "}
              <strong>Publication</strong>: choose a preset or manual plot-area width and height, then download vector
              SVG or PNG. PNG uses the selected DPI; SVG stays vector. Legends stack vertically on the right with extra
              export space, so they do not shrink the chosen plot area.
            </DocLi>
            <DocLi>
              Peak markers and assignment labels render as annotations; drag edits may persist when the UI stores label
              offsets.
            </DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "peaks-table",
      title: "Peaks table",
      keywords: ["table", "wn", "prominence"],
      body: (
        <DocP>
          Lists picked peaks with wavenumber, height/y, prominence, and top assignment when available. Use this to audit
          what the plot shows before exporting CSV/HTML.
        </DocP>
      ),
    },
    {
      id: "drag-drop",
      title: "Drag and drop",
      keywords: ["drop", "file"],
      body: (
        <DocP>
          You can drag spectrum files onto the FTIR view; a full-screen overlay indicates drop readiness. Same formats as
          the file picker.
        </DocP>
      ),
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      keywords: ["error", "parse"],
      body: (
        <DocUl>
          <DocLi>Unsupported or malformed JCAMP/CSV shows an error banner—fix delimiter or column headers.</DocLi>
          <DocLi>Empty plot after preprocess: check that masking or normalization did not zero the trace.</DocLi>
          <DocLi>No assignments: run peak pick with assign enabled and verify library version is loaded.</DocLi>
        </DocUl>
      ),
    },
  ],
};
