import type { HelpModule } from "../types";
import { DocCode, DocLead, DocLi, DocNote, DocOl, DocP, DocUl } from "../docPrimitives";

export const lcmsHelpModule: HelpModule = {
  title: "LCMS — help",
  topics: [
    {
      id: "overview",
      title: "Overview",
      keywords: ["lcms", "mzml", "start", "tic", "spectrum"],
      body: (
        <>
          <DocLead>
            Open an mzML run, click the total ion chromatogram (TIC) to see the MS1 spectrum at that time, and use
            extracted ion chromatograms (EICs) and polymer matching to find your products.
          </DocLead>
          <DocOl>
            <DocLi>
              <strong>Open mzML…</strong> (or drop files on the page). Each file appears in the sessions list on the
              left.
            </DocLi>
            <DocLi>Pick a polarity (ESI+ or ESI−) at the top of the charts.</DocLi>
            <DocLi>Click a peak on the TIC: the spectrum below shows that scan, with the strongest peaks labelled.</DocLi>
            <DocLi>
              To follow one mass over time, make an <strong>EIC</strong>; to label a whole polymer series, set up{" "}
              <strong>Polymer Match</strong>.
            </DocLi>
          </DocOl>
          <DocNote>
            Can't find a button? Press <DocCode>Ctrl K</DocCode> and type what you want to do. Hover any control for a
            short explanation, or press <DocCode>F1</DocCode> on it to jump here.
          </DocNote>
        </>
      ),
    },
    {
      id: "files-workspace",
      title: "Files and workspace",
      keywords: ["open", "mzml", "workspace", "json", "upload"],
      body: (
        <>
          <DocUl>
            <DocLi>
              <strong>Open mzML…</strong> accepts one or more <DocCode>.mzML</DocCode> files. MS1 scans are indexed on
              upload, so re-opening is fast. The time unit stored in the file is read automatically.
            </DocLi>
            <DocLi>
              <strong>Save workspace</strong> writes the open files and all settings to a JSON file;{" "}
              <strong>Load workspace</strong> restores it.
            </DocLi>
          </DocUl>
        </>
      ),
      children: [
        {
          id: "uv-csv",
          title: "UV / DAD chromatogram",
          keywords: ["uv", "csv", "dad", "chromatogram", "offset"],
          body: (
            <>
              <DocP>
                Most mzML files contain only MS scans. Export the UV/DAD trace from your LC software as CSV (time and
                signal columns) and use <strong>Attach CSV…</strong> on the UV chart.
              </DocP>
              <DocUl>
                <DocLi>
                  The time unit of the CSV is read from its header (e.g. <DocCode>Time (sec)</DocCode>); otherwise
                  minutes are assumed. Change it under Display → <strong>UV CSV time unit</strong>.
                </DocLi>
                <DocLi>
                  The UV detector usually sits before or after the MS, so its peaks are shifted in time. Set the shift
                  under the UV chart's <strong>Label options → UV↔MS alignment</strong>, or use{" "}
                  <strong>Auto-align</strong>.
                </DocLi>
              </DocUl>
            </>
          ),
        },
      ],
    },
    {
      id: "sessions-projects",
      title: "Sessions and projects",
      keywords: ["session", "project", "folder", "remove", "pin"],
      body: (
        <DocUl>
          <DocLi>Each open file is a session. Click one to show it; the line above the charts summarises it.</DocLi>
          <DocLi>
            <strong>+ Project</strong> makes a folder; move files into it with the <strong>Move to project</strong> menu
            on each row.
          </DocLi>
          <DocLi>Pin the list to keep it open; unpinned it opens when you hover the left edge.</DocLi>
        </DocUl>
      ),
    },
    {
      id: "tools-panel",
      title: "Tools panel: Analysis and Display",
      keywords: ["tools", "panel", "analysis", "display", "collapse"],
      body: (
        <>
          <DocP>The panel on the right has two tabs. Collapse it with the arrow to give the charts more room.</DocP>
          <DocUl>
            <DocLi>
              <strong>Analysis</strong>: scan navigation, EIC and Find m/z, jump to a retention time, spectrum peak
              labels, polymer & reaction matching, feature table, comparison and label export.
            </DocLi>
            <DocLi>
              <strong>Display</strong>: units, polarity, which charts are shown, TIC region selection, overlays of other
              files and CSV exports.
            </DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "navigate-tab",
      title: "Analysis tab: moving through the run",
      keywords: ["navigate", "scan", "jump", "rt", "next", "previous"],
      body: (
        <DocUl>
          <DocLi>
            <strong>Prev / Next / First / Last</strong> step through MS1 scans; the arrow keys do the same.
          </DocLi>
          <DocLi>
            <strong>Jump to RT</strong> opens the scan nearest the time you type (in the RT display unit).
          </DocLi>
          <DocLi>
            <strong>EIC…</strong> and <strong>Find m/z…</strong> are described under Dialogs.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "annotate-tab",
      title: "Analysis tab: spectrum labels",
      keywords: ["labels", "annotate", "top n", "relative intensity", "drag"],
      body: (
        <DocUl>
          <DocLi>
            <strong>Annotate spectrum peaks</strong> labels the strongest peaks with their m/z.
          </DocLi>
          <DocLi>
            <strong>Top N</strong> (default 10) and <strong>Min rel intensity</strong> (default 0.05 = 5% of the base
            peak) decide which peaks get a label.
          </DocLi>
          <DocLi>
            With <strong>dragging labels</strong> on, move overlapping labels by hand; <strong>Reset positions</strong>{" "}
            on the spectrum puts them back.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "view-tab",
      title: "Display tab",
      keywords: ["polarity", "units", "panels", "overlay", "region", "display"],
      body: (
        <DocUl>
          <DocLi>
            <strong>Polarity</strong>: all scans, ESI+ only, ESI− only, or both side by side (Dual). If the file has no
            scans of the chosen polarity you get a message instead of the other polarity's data.
          </DocLi>
          <DocLi>
            <strong>RT display unit</strong> only changes how times are shown; the file's own unit is always used for
            the data.
          </DocLi>
          <DocLi>
            <strong>Region select</strong>: drag across the TIC to select a time window, then{" "}
            <strong>Sum RT window</strong> sums all MS1 scans in it. <strong>Ignore m/z</strong> keeps a dominant
            contaminant from swamping the summed spectrum's scale.
          </DocLi>
          <DocLi>
            <strong>Overlays</strong>: tick other open files to draw their TIC, UV, spectrum or EICs on the same chart.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "charts-tic",
      title: "TIC chart",
      keywords: ["tic", "chromatogram", "slice", "integrate", "sync"],
      body: (
        <DocUl>
          <DocLi>
            <strong>Inspect</strong>: click the TIC to open the scan at that time.
          </DocLi>
          <DocLi>
            <strong>Slice</strong>: drag across a peak to integrate its area between the two times (undo with Ctrl+Z).
          </DocLi>
          <DocLi>
            With overlays: <strong>Raw</strong> shared scale, <strong>% Norm</strong> each trace to its own base peak,
            or <strong>Stacked</strong>.
          </DocLi>
          <DocLi>
            <strong>Sync zoom</strong> zooms the TIC and UV chromatograms together.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "charts-eic",
      title: "EIC chart",
      keywords: ["eic", "xic", "extracted ion", "integrate"],
      body: (
        <DocP>
          An extracted ion chromatogram sums MS1 intensity in a window (Da or ppm) around one m/z, so you can see when
          that mass elutes. <strong>Integrate</strong> reports each EIC's peak area, apex time and height;{" "}
          <strong>Clear</strong> removes them. EICs can also be made from a spectrum peak, the deconvolution results,
          the Kendrick plot and the expected-products list.
        </DocP>
      ),
    },
    {
      id: "charts-spectrum",
      title: "MS1 spectrum chart",
      keywords: ["spectrum", "ms1", "butterfly", "deconvolute", "polymer studio"],
      body: (
        <DocUl>
          <DocLi>
            Type an m/z (or pick a detected peak) and <strong>Inspect</strong> it, or create its EIC.
          </DocLi>
          <DocLi>
            <strong>Zoom / Move labels</strong> switches between drawing zoom boxes and dragging labels.
          </DocLi>
          <DocLi>
            With overlays: <strong>Overlay</strong>, <strong>Butterfly</strong> (mirrored, head-to-tail),{" "}
            <strong>Butterfly %</strong> or <strong>% Norm</strong>. Press <DocCode>B</DocCode> to cycle.
          </DocLi>
          <DocLi>
            <strong>Polymer Studio</strong> tunes polymer matching while the labels update live;{" "}
            <strong>Deconvolute</strong> turns a multiply charged envelope into neutral masses.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "charts-uv",
      title: "UV chromatogram chart",
      keywords: ["uv", "labels", "auto label", "transfer", "stairs"],
      body: (
        <DocUl>
          <DocLi>
            <strong>Auto label peaks</strong> finds UV peaks and labels each with the main m/z of the MS scan at that
            time; <strong>Label RT</strong> and <strong>Custom</strong> add single labels.
          </DocLi>
          <DocLi>
            <strong>Label options</strong>: detection threshold (fraction of the tallest UV peak, default 0.05) and
            spacing (default 0.2 min), label orientation and snapping, MS transfer, grouping identical labels,
            auto-arranged stairs, and the UV↔MS time offset.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "find-mz",
      title: "Find m/z",
      keywords: ["find", "mz", "search", "locate"],
      body: (
        <DocP>
          Analysis tab → <strong>Find m/z…</strong>. Enter a target m/z and tolerance (Da or ppm). It sweeps all MS1
          scans of the current polarity and jumps to the time where that mass is most intense.
        </DocP>
      ),
    },
    {
      id: "dialogs",
      title: "Dialogs",
      keywords: ["dialog", "eic", "feature table", "comparison", "deconvolution", "kendrick"],
      body: (
        <DocUl>
          <DocLi>
            <strong>EIC</strong>: target m/z and tolerance for a new extracted ion chromatogram.
          </DocLi>
          <DocLi>
            <strong>Feature table</strong>: integrated features (m/z, RT, area, height) you can label, annotate and
            export.
          </DocLi>
          <DocLi>
            <strong>Comparison</strong>: a matrix of feature area or height across the open files; rows group by expected
            product or label first, otherwise by m/z.
          </DocLi>
          <DocLi>
            <strong>Deconvolution</strong>: finds charge states (default z 1–8) belonging to one neutral mass.
          </DocLi>
          <DocLi>
            <strong>Kendrick plot</strong>: mass defect against m/z for a repeat unit; one polymer series lines up
            horizontally.
          </DocLi>
          <DocLi>
            <strong>Expected products</strong>: monomer/dimer/trimer products of your monomers and whether each is in the
            spectrum.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "graph-settings-detail",
      title: "Chart design",
      keywords: ["design", "graph settings", "title", "axis", "colour", "font"],
      body: (
        <DocP>
          <strong>Design</strong> on each chart sets its title, axis titles and limits (blank = automatic), size,
          colours, line or bar width, fonts, grid and frame. <strong>Set current as default</strong> keeps them for new
          files. Figures for papers come from <strong>Export</strong> (see Exports).
        </DocP>
      ),
    },
    {
      id: "polymer-controls",
      title: "Polymer & reaction matching",
      keywords: ["polymer", "monomer", "dp", "tolerance", "adduct", "oligomer"],
      body: (
        <>
          <DocP>
            Labels spectrum peaks that match compositions of your monomers. Needs ESI+ or ESI− (not All).
          </DocP>
          <DocOl>
            <DocLi>
              Analysis tab → <strong>Polymer Match…</strong>. Tick your monomers (or type others as{" "}
              <DocCode>Name Mass</DocCode>).
            </DocLi>
            <DocLi>
              Check <strong>Per-bond delta</strong>: −18.010565 for condensation (ester/amide), 0 for addition
              polymers. Add end groups as <strong>Extra delta</strong>.
            </DocLi>
            <DocLi>
              Set <strong>Max DP</strong> (start with 3–6), tolerance (10–20 ppm high-res, 0.05–0.2 Da low-res), charges
              and adducts.
            </DocLi>
            <DocLi>
              Turn on <strong>Enable polymer matching</strong>. Labels like <DocCode>2-GA + 1-His</DocCode> appear on
              matching peaks.
            </DocLi>
          </DocOl>
          <DocP>
            <strong>Expected products</strong> lists what should be there and what was found;{" "}
            <strong>Kendrick plot</strong> shows whole series; <strong>Save as defaults</strong> keeps the settings for
            new files.
          </DocP>
        </>
      ),
    },
    {
      id: "polymer-math",
      title: "Polymer matching: how it's calculated",
      keywords: ["algorithm", "mass", "ppm", "composition", "variant", "calculation"],
      body: (
        <>
          <DocOl>
            <DocLi>Only peaks at or above Min rel intensity × the base peak take part.</DocLi>
            <DocLi>Every combination of the ticked monomers from 1 up to Max DP units is enumerated.</DocLi>
            <DocLi>
              Neutral mass = sum of monomer masses + (DP − 1) × per-bond delta + extra delta.
            </DocLi>
            <DocLi>
              Variants (water loss, −CO₂, +O, 2M dimers) add their mass shift when ticked.
            </DocLi>
            <DocLi>
              For each charge z: m/z = (M + z × 1.007276) / z, labelled [M+zH]<sup>z+</sup> (or [M−zH]<sup>z−</sup>).
              Na, K, Cl, formate and acetate adducts are matched as singly charged only; a custom adduct uses its own
              mass and charge.
            </DocLi>
            <DocLi>
              A peak matches when it is within the tolerance (Da, or ppm of the predicted m/z). Per peak, the best match
              has the smallest ppm error, then the higher intensity.
            </DocLi>
          </DocOl>
          <DocNote>
            Too many monomers with a large Max DP is refused as "search too large": tick fewer monomers or lower Max DP.
          </DocNote>
        </>
      ),
    },
    {
      id: "polymer-example",
      title: "Polymer example",
      keywords: ["example", "walk-through", "glycolic", "histidine"],
      body: (
        <DocP>
          Tick glycolic acid (GA) and histidine (His), keep charge 1, Max DP 4 and 0.02 Da. On a spectrum with an
          oligomer ladder you should see labels like <DocCode>2-GA + 1-His</DocCode>. If labels systematically miss,
          check polarity, adducts and the per-bond delta before widening the tolerance.
        </DocP>
      ),
    },
    {
      id: "exports",
      title: "Exports",
      keywords: ["export", "csv", "svg", "png", "publication", "download"],
      body: (
        <DocUl>
          <DocLi>
            <strong>Export</strong> on each chart: 1:1 as on screen, or at a journal size (ACS, Nature, RSC) as SVG
            (vector) or PNG at the chosen DPI, with a white background.
          </DocLi>
          <DocLi>
            Display tab: <strong>Spectrum CSV</strong>, <strong>UV CSV</strong>, <strong>TIC overlay CSV</strong>.
          </DocLi>
          <DocLi>
            Analysis tab: <strong>Export labels (all scans)</strong> — the labelled peaks of every MS1 scan.
          </DocLi>
          <DocLi>Feature table, comparison, deconvolution and expected products each have their own CSV export.</DocLi>
        </DocUl>
      ),
    },
    {
      id: "shortcuts",
      title: "Keyboard shortcuts",
      keywords: ["keyboard", "shortcut", "keys", "hotkey"],
      body: (
        <DocUl>
          <DocLi>
            <DocCode>←</DocCode> / <DocCode>→</DocCode> previous / next scan
          </DocLi>
          <DocLi>
            <DocCode>B</DocCode> cycle the spectrum overlay mode · <DocCode>O</DocCode> overlay spectra on/off
          </DocLi>
          <DocLi>
            <DocCode>Esc</DocCode> clear the TIC region selection
          </DocLi>
          <DocLi>
            <DocCode>Ctrl Z</DocCode> / <DocCode>Ctrl Y</DocCode> undo / redo slices and EIC actions
          </DocLi>
          <DocLi>
            <DocCode>Ctrl K</DocCode> find a control · <DocCode>F1</DocCode> help for the control under the pointer
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "status-bar",
      title: "Status bar",
      keywords: ["status", "footer"],
      body: <DocP>The line at the bottom shows the active file, polarity and UV offset, and short status messages.</DocP>,
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      keywords: ["error", "problem", "missing", "no spectrum"],
      body: (
        <DocUl>
          <DocLi>
            <strong>No spectrum</strong>: click the TIC (or jump to an RT) and check that the file has scans of the
            chosen polarity.
          </DocLi>
          <DocLi>
            <strong>No UV</strong>: attach the UV CSV; mzML files usually have no UV trace.
          </DocLi>
          <DocLi>
            <strong>Polymer labels missing</strong>: polarity must be ESI+ or ESI−, at least one monomer ticked, and
            matching enabled.
          </DocLi>
          <DocLi>
            <strong>"Search too large"</strong>: fewer monomers, smaller Max DP, fewer variants.
          </DocLi>
          <DocLi>
            <strong>Network errors</strong>: the analysis server isn't reachable; ask whoever runs it to restart it.
          </DocLi>
        </DocUl>
      ),
    },
  ],
};
