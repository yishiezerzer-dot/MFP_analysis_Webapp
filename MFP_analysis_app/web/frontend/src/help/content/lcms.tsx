import type { HelpModule } from "../types";
import { DocCode, DocH4, DocLead, DocLi, DocNote, DocOl, DocP, DocUl } from "../docPrimitives";

export const lcmsHelpModule: HelpModule = {
  title: "LCMS — help",
  topics: [
    {
      id: "overview",
      title: "Overview",
      keywords: ["mzml", "tic", "spectrum", "uv", "workflow"],
      searchText: "liquid chromatography mass spectrometry viewer",
      body: (
        <>
          <DocLead>
            The LCMS module loads one or more <DocCode>.mzML</DocCode> runs, shows the total ion chromatogram (TIC),
            optional extracted ion chromatogram (EIC) and UV trace, and plots the MS1 spectrum at a selected retention
            time. Use the header to open files and workspaces; use the left sidebar for sessions and projects; use the
            tools column for navigation, annotation, and polymer matching.
          </DocLead>
          <DocP>
            Backend parsing and session APIs live under <DocCode>MFP_analysis_app/web/backend/app/routers/lcms.py</DocCode>{" "}
            and <DocCode>lcms_service.py</DocCode>. The UI talks to them through <DocCode>api.ts</DocCode>.
          </DocP>
        </>
      ),
    },
    {
      id: "files-workspace",
      title: "Files and workspace",
      keywords: ["mzml", "json", "upload", "save", "load workspace"],
      body: (
        <>
          <DocH4>Open mzML</DocH4>
          <DocUl>
            <DocLi>
              <strong>Open mzML…</strong> accepts <DocCode>.mzML</DocCode> (multi-file). Each file becomes a session with
              MS1 metadata and TIC points.
            </DocLi>
            <DocLi>While a file is loading the header button shows “Loading…”.</DocLi>
          </DocUl>
          <DocH4>Workspace JSON</DocH4>
          <DocUl>
            <DocLi>
              <strong>Load workspace</strong> reads a previously saved JSON bundle (sessions, UI state, labels where
              applicable).
            </DocLi>
            <DocLi>
              <strong>Save workspace</strong> exports the current workspace; disabled until at least one session exists.
            </DocLi>
          </DocUl>
          <DocNote>
            mzML paths may be server-side temp paths after upload; keep workspace files for reproducibility if you rely
            on re-opening without re-uploading.
          </DocNote>
        </>
      ),
      children: [
        {
          id: "uv-csv",
          title: "UV / DAD CSV attachment",
          keywords: ["uv", "csv", "dad", "chromatogram"],
          body: (
            <>
              <DocP>
                Many mzML files contain MS only. Attach a separate UV trace as CSV (time + signal columns) from the LC
                software. The chart offers <strong>Attach UV CSV</strong>, <strong>Replace</strong>, and{" "}
                <strong>Remove</strong>. Column detection tries to infer RT units and axes; warnings appear if
                ambiguous.
              </DocP>
            </>
          ),
        },
      ],
    },
    {
      id: "sessions-projects",
      title: "Sessions sidebar and projects",
      keywords: ["session", "project", "pin", "sidebar"],
      body: (
        <>
          <DocP>
            Each loaded mzML appears as a session. Click a session to make it active; the ribbon shows the active dataset
            summary (name, MS1 count, RT span, polarity filter, UV state).
          </DocP>
          <DocH4>Projects</DocH4>
          <DocP>
            Sessions can be grouped into projects for organization. Use the sidebar controls to create projects and move
            sessions between them. Pinning and hover-expand behavior keeps long lists manageable.
          </DocP>
        </>
      ),
    },
    {
      id: "view-tab",
      title: "View tab (polarity, RT units, panels, overlays)",
      keywords: ["polarity", "positive", "negative", "seconds", "minutes", "overlay"],
      body: (
        <>
          <DocUl>
            <DocLi>
              <strong>Polarity</strong> filters which MS1 scans contribute to TIC and spectrum (positive / negative /
              all).
            </DocLi>
            <DocLi>
              <strong>RT units</strong> switch the chromatogram X axis between minutes and seconds (stored RT is still
              interpreted consistently when loading spectra).
            </DocLi>
            <DocLi>
              <strong>Show TIC / spectrum / UV</strong> toggles entire chart cards for a cleaner layout when you only
              need one view.
            </DocLi>
            <DocLi>
              <strong>Overlays</strong> let you plot TIC, UV, and/or MS1 spectrum traces from additional sessions on the
              same axes (after enabling the overlay checkboxes and picking session IDs). Colors come from a fixed
              palette per overlay index.
            </DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "primary-actions",
      title: "Primary Actions (header strip in main column)",
      keywords: ["primary", "actions", "ribbon"],
      body: (
        <>
          <DocP>
            The <strong>Primary Actions</strong> card groups the most common file and spectrum operations: opening mzML,
            attaching UV, running quant shortcuts exposed there, and other one-click tasks wired in the main column. Exact
            buttons evolve with releases—hover tooltips on each control describe the current action.
          </DocP>
        </>
      ),
    },
    {
      id: "tools-panel",
      title: "Workflow and Tools column (tabs)",
      keywords: ["tools", "sidebar", "tabs", "navigate", "view", "annotate", "polymer"],
      body: (
        <>
          <DocP>
            The right-hand column hosts collapsible <strong>Workflow & Tools</strong> with inner tabs:{" "}
            <strong>Navigate</strong>, <strong>View</strong>, <strong>Annotate</strong>, and <strong>Polymer</strong>.
            Use the collapse control to maximize chart area on small screens.
          </DocP>
          <DocUl>
            <DocLi>
              <strong>Navigate</strong>: RT stepping, jump, optional TIC region integration, UV offset / auto-align.
            </DocLi>
            <DocLi>
              <strong>View</strong>: polarity, RT units, which charts are visible, overlay session pickers.
            </DocLi>
            <DocLi>
              <strong>Annotate</strong>: spectrum label thresholds, UV transfer and label layout, optional debug toggles
              when present.
            </DocLi>
            <DocLi>
              <strong>Polymer</strong>: quick access to matcher settings and the full polymer dialog.
            </DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "dataset-ribbon",
      title: "Dataset ribbon (active session)",
      keywords: ["ribbon", "active", "session"],
      body: (
        <DocP>
          Below the header, the ribbon summarizes the active session: truncated filename, MS1 scan count, approximate RT
          span, polarity filter label, and whether UV is attached. It updates when you switch sessions or change filters.
        </DocP>
      ),
    },
    {
      id: "navigate-tab",
      title: "Navigate tab (RT stepping, jump, region, UV align)",
      keywords: ["rt", "jump", "region", "align", "offset"],
      body: (
        <>
          <DocH4>RT controls</DocH4>
          <DocUl>
            <DocLi>
              Step buttons move the selected RT to the previous/next MS1 scan (or similar discretization depending on
              data).
            </DocLi>
            <DocLi>
              <strong>Jump</strong> parses typed RT text and loads the spectrum nearest that time (respecting RT unit
              mode).
            </DocLi>
            <DocLi>
              <strong>Region select on TIC</strong> (when enabled) lets you drag a retention-time span; releasing runs
              “sum spectrum” logic for that span instead of a single scan (see chart help).
            </DocLi>
          </DocUl>
          <DocH4>UV offset and auto-align</DocH4>
          <DocP>
            UV time axis may differ slightly from MS acquisition clocks. Set a manual offset (minutes) or run auto-align
            to estimate a shift that lines up UV features with MS/TIC features. Clicking the UV chart passes both display
            RT and corrected UV RT into spectrum loading when applicable.
          </DocP>
        </>
      ),
    },
    {
      id: "annotate-tab",
      title: "Annotate tab (spectrum labels, UV labels, transfer)",
      keywords: ["label", "annotate", "top n", "transfer", "uv label", "stairs"],
      body: (
        <>
          <DocH4>MS1 spectrum labels</DocH4>
          <DocUl>
            <DocLi>
              <strong>Annotate spectrum</strong> toggles automatic peak picking labels on the MS1 plot.
            </DocLi>
            <DocLi>
              <strong>Top N</strong> limits how many peaks are labeled by descending intensity.
            </DocLi>
            <DocLi>
              <strong>Min relative intensity</strong> drops weak peaks as a fraction of the base peak in the current
              spectrum.
            </DocLi>
            <DocLi>
              <strong>Enable drag labels</strong> allows Plotly annotation drag; positions persist per label where the UI
              stores offsets.
            </DocLi>
          </DocUl>
          <DocH4>UV chromatogram labels</DocH4>
          <DocUl>
            <DocLi>
              Transfer controls copy MS/polymer labels onto UV at the current anchor RT (with optional snap-to-UV peak).
            </DocLi>
            <DocLi>
              <strong>UV label orientation</strong> switches vertical vs horizontal annotation text.
            </DocLi>
            <DocLi>
              Stair parameters control auto-arrange spacing when many labels overlap in RT clusters.
            </DocLi>
            <DocLi>
              <strong>Auto arrange</strong> rebuilds label anchor offsets into local “stairs” grouped by hydroxy count
              parsed from label text (polymer-style labels).
            </DocLi>
            <DocLi>
              Graph settings for UV include optional <strong>connector line color</strong> and <strong>opacity</strong>{" "}
              for leader lines (Plotly <DocCode>arrowcolor</DocCode>).
            </DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "charts-tic",
      title: "TIC chart",
      keywords: ["tic", "chromatogram", "click"],
      body: (
        <>
          <DocP>
            Clicking the TIC loads the MS1 spectrum at that retention time (unless region mode is active). Hover shows RT
            and intensity. Use graph settings to change colors, line width, axis limits, grid, and title sizes.
          </DocP>
        </>
      ),
    },
    {
      id: "charts-eic",
      title: "EIC chart",
      keywords: ["eic", "mz", "tolerance"],
      body: (
        <>
          <DocP>
            The extracted ion chromatogram sums MS1 intensity inside an m/z window around a target mass. Open the EIC
            dialog to set target m/z and tolerance (Da). The backend returns time points and intensities for plotting.
          </DocP>
        </>
      ),
    },
    {
      id: "charts-uv",
      title: "UV chromatogram chart",
      keywords: ["uv", "chromatogram", "svg", "label"],
      body: (
        <>
          <DocP>
            When UV CSV is attached, the trace renders with the same RT axis scaling as MS (plus offset). Clicking
            selects spectrum loading with UV RT context. <strong>Save SVG</strong> exports the Plotly view.
          </DocP>
          <DocP>
            Transferred labels support edit/delete/clear and draggable annotation handles when enabled in graph config.
          </DocP>
        </>
      ),
    },
    {
      id: "charts-spectrum",
      title: "MS1 spectrum chart",
      keywords: ["spectrum", "mz", "intensity"],
      body: (
        <>
          <DocP>
            Bar or line styling depends on graph settings. Labels (manual or automatic) render as Plotly annotations.
            Exports (CSV/JSON) typically include the visible m/z–intensity pairs and label metadata where implemented in
            the view.
          </DocP>
        </>
      ),
    },
    {
      id: "find-mz",
      title: "Find m/z sweep",
      keywords: ["find", "mz", "search"],
      body: (
        <DocP>
          Opens from the Navigate tools when available. Enter a target m/z and tolerance (Da). The tool scans chromatogram
          data for hits and can move the RT cursor to the strongest match. Close the dialog with the dismiss control when
          finished.
        </DocP>
      ),
    },
    {
      id: "status-bar",
      title: "Status bar",
      keywords: ["status", "footer"],
      body: (
        <DocP>
          The footer shows a compact summary of the active session and UV offset so you always know what data the charts
          are bound to without opening the ribbon.
        </DocP>
      ),
    },
    {
      id: "dialogs",
      title: "Dialogs (Find m/z, EIC, custom UV label, graph settings, polymer)",
      keywords: ["dialog", "modal", "find", "eic"],
      body: (
        <>
          <DocUl>
            <DocLi>
              <strong>Find m/z</strong> scans across RT for a target mass within tolerance and can jump the RT cursor to
              hits.
            </DocLi>
            <DocLi>
              <strong>EIC dialog</strong> configures target m/z and tolerance before fetching chromatogram data.
            </DocLi>
            <DocLi>
              <strong>Custom UV label</strong> creates a text label snapped (or not) to a typed RT on UV.
            </DocLi>
            <DocLi>
              <strong>Graph settings</strong> is a tabbed modal for TIC, UV, and MS1 spectrum appearance (titles, axis
              limits, fonts, line widths, UV label connector styling, etc.).
            </DocLi>
            <DocLi>
              <strong>Polymer dialog</strong> edits the full polymer matcher configuration sent to the backend.
            </DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "graph-settings-detail",
      title: "Graph Settings dialog (TIC / UV / MS1)",
      keywords: ["graph", "settings", "axis", "font", "height"],
      body: (
        <>
          <DocP>
            Opened from chart cards. Three sections mirror the three plot types. Common controls: graph title, axis
            titles, height in pixels, line color/width (or bar width for spectrum mode), title and tick font sizes, grid
            and frame style, manual axis min/max (leave blank for auto-scale on that axis), and label fonts/colors.
          </DocP>
          <DocP>
            UV-specific options may include connector line color and opacity for label leader lines. Use{" "}
            <strong>Set current as default</strong> inside the dialog to persist defaults to browser storage for new
            sessions.
          </DocP>
        </>
      ),
    },
    {
      id: "polymer-controls",
      title: "Polymer tab — UI controls",
      keywords: ["polymer", "monomer", "dp", "tolerance", "adduct"],
      body: (
        <>
          <DocP>
            The polymer tab surfaces the same conceptual settings as the desktop matcher: monomer table (name,_abbr,
            mass, category), shared tolerances, max degree of polymerization (DP), bond and extra mass deltas, charge
            list, optional decarboxylation / oxidation / cluster modes, adduct toggles (Na/K/Cl/formate/acetate), minimum
            relative intensity for peaks considered, and advanced/debug flags when exposed.
          </DocP>
          <DocP>
            Running the matcher sends current MS1 peak list and settings to the API; returned labels attach to spectrum
            annotations with polymer vs custom provenance where distinguished in the UI.
          </DocP>
        </>
      ),
    },
    {
      id: "polymer-math",
      title: "Polymer matching — how the math works",
      keywords: ["algorithm", "mass", "ppm", "composition", "variant", "score"],
      searchText:
        "compute_polymer_best_by_peak_sorted neutral mz_pred tolerance variants adducts compositions confidence",
      body: (
        <>
          <DocLead>
            The reference implementation is <DocCode>compute_polymer_best_by_peak_sorted</DocCode> in{" "}
            <DocCode>MFP_analysis_app/lab_gui/lcms_polymer_match.py</DocCode> (shared logic conceptually with the Qt
            app). The web UI maps directly to these parameters.
          </DocLead>
          <DocH4>1) Peak filtering</DocH4>
          <DocP>
            MS1 peaks are sorted by m/z. The global maximum intensity <DocCode>max_int</DocCode> is found. Only peaks with
            intensity ≥ <DocCode>min_rel_int × max_int</DocCode> participate in matches (relative threshold).
          </DocP>
          <DocH4>2) Composition enumeration</DocH4>
          <DocP>
            For <DocCode>n</DocCode> enabled monomer types, the code enumerates non-negative integer count vectors{" "}
            <DocCode>counts[]</DocCode> with total monomer units <DocCode>dp</DocCode> between 1 and <DocCode>max_dp</DocCode>
            . Before enumerating, an estimated composition count is computed; if it exceeds ~2M,{" "}
            <DocCode>PolymerSearchTooLarge</DocCode> is raised—reduce monomers, lower max DP, or disable variant/adduct
            combinations.
          </DocP>
          <DocH4>3) Neutral polymer mass</DocH4>
          <DocP>
            For each composition, monomer masses are summed, then <DocCode>(dp − 1) × bond_delta + extra_delta</DocCode>{" "}
            accounts for inter-monomer bonds and fixed extras. That yields a neutral “poly” mass before optional
            variants.
          </DocP>
          <DocH4>4) Variants (oxidation / decarb)</DocH4>
          <DocP>
            If compatibility mode is off, <DocCode>generate_variants</DocCode> builds small-mass-shift tags (oxidation /
            CO₂ loss and optional combined) controlled by the oxid/decarb toggles and “allow combo”. Each variant adds{" "}
            <DocCode>v.mass_delta</DocCode> to the neutral mass and maps to a display <DocCode>kind</DocCode> bucket (poly,
            ox, decarb, oxdecarb, …).
          </DocP>
          <DocH4>5) Charge and adducts</DocH4>
          <DocP>
            For each charge state <DocCode>z</DocCode> in the configured list (defaults to positive integers), and each
            polymer adduct mass delta from <DocCode>build_default_adduct_deltas</DocCode>, the predicted m/z is{" "}
            <DocCode>mz_pred = (neutral_variant + adduct_mass) / z</DocCode>. Cluster mode uses a parallel adduct table
            built from the cluster base mass.
          </DocP>
          <DocH4>6) Tolerance test</DocH4>
          <DocP>
            <DocCode>tol_unit</DocCode> either fixes a Da window or converts to Da from ppm at the predicted m/z via{" "}
            <DocCode>_tol_to_da</DocCode>. The matcher calls <DocCode>find_best_peak_match</DocCode> on the sorted m/z
            array preferring higher intensity ties inside tolerance.
          </DocP>
          <DocH4>7) Choosing the “best” label per peak and kind</DocH4>
          <DocP>
            For each candidate that hits a peak, <DocCode>set_best</DocCode> keeps the winner per (peak index, kind) with
            tie order: <strong>lower ppm error</strong>, then <strong>higher peak intensity</strong>, then{" "}
            <strong>lower absolute Da error</strong>.
          </DocP>
          <DocH4>8) Optional confidence gate</DocH4>
          <DocP>
            If the environment variable <DocCode>LAB_GUI_POLYMER_MIN_SCORE</DocCode> is set to a number in [0, 1], a
            heuristic score mixing normalized ppm closeness and intensity can drop weak hits. In normal desktop use
            this is usually unset (no gating).
          </DocP>
        </>
      ),
    },
    {
      id: "polymer-example",
      title: "Polymer example (walk-through)",
      keywords: ["example", "his", "glycolic", "tutorial"],
      body: (
        <>
          <DocOl>
            <DocLi>
              Enable two monomers, e.g. hydroxy acid “GA” and amino acid “His”, with accurate monoisotopic masses from
              your preset table.
            </DocLi>
            <DocLi>
              Set charges to <DocCode>[1]</DocCode> for simple protonated species unless you expect multimers.
            </DocLi>
            <DocLi>
              Set <strong>max DP</strong> to a small number (3–6) while testing so the composition search stays fast.
            </DocLi>
            <DocLi>
              Choose tolerance: start with 10–20 ppm for high-res or 0.05–0.2 Da for low-res data; tighten if you get
              ambiguous labels.
            </DocLi>
            <DocLi>
              Run the matcher on a spectrum that contains oligomer ladders. You should see labels like{" "}
              <DocCode>2-GA + 1-His … z=1</DocCode> when a composition’s predicted m/z lands on a peak within tolerance.
            </DocLi>
            <DocLi>
              Inspect isotope cluster spacing: if labels systematically miss, verify polarity, adduct toggles, and bond
              / extra deltas first before widening tolerance blindly.
            </DocLi>
          </DocOl>
        </>
      ),
    },
    {
      id: "exports",
      title: "Exports and downloads",
      keywords: ["csv", "json", "download", "save", "svg", "png"],
      body: (
        <>
          <DocP>
            Anywhere the UI offers CSV/JSON/SVG/PNG export, the file is generated in-browser (Blob + download) or via
            Plotly’s <DocCode>downloadImage</DocCode> for static chart images. Workspace JSON is the aggregate state
            snapshot from the save action in the header.
          </DocP>
        </>
      ),
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      keywords: ["error", "empty", "failed", "backend"],
      body: (
        <>
          <DocUl>
            <DocLi>
              <strong>No spectrum</strong>: confirm a session is active and you clicked the TIC (or jumped RT) while MS1
              data exists for that polarity.
            </DocLi>
            <DocLi>
              <strong>UV missing</strong>: attach CSV; mzML alone often has no DAD trace.
            </DocLi>
            <DocLi>
              <strong>Polymer “too large”</strong>: reduce search space per the math section (fewer monomers, smaller max
              DP, fewer variant/adduct combos).
            </DocLi>
            <DocLi>
              <strong>Network errors</strong>: ensure FastAPI is running and the Vite proxy targets the same port as{" "}
              <DocCode>api.ts</DocCode>.
            </DocLi>
          </DocUl>
        </>
      ),
    },
  ],
};
