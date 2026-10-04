import type { HelpModule } from "../types";
import { DocCode, DocLead, DocLi, DocNote, DocOl, DocP, DocUl } from "../docPrimitives";

export const ftirHelpModule: HelpModule = {
  title: "FTIR — help",
  topics: [
    {
      id: "overview",
      title: "Overview",
      keywords: ["ftir", "spectrum", "infrared", "start"],
      body: (
        <>
          <DocLead>
            Open a spectrum, clean it up (baseline, normalisation), pick peaks and let the bond library suggest what
            each peak is. Quantify bands, subtract spectra or match against reference spectra when you need more.
          </DocLead>
          <DocOl>
            <DocLi>
              <strong>Open FTIR file(s)…</strong> or drop files on the page.
            </DocLi>
            <DocLi>
              In the right panel, <strong>Preprocess</strong>: choose a <strong>preset</strong> for your sample type
              (KBr disc, ATR sample, polymer thin film, raw film).
            </DocLi>
            <DocLi>
              <strong>Peaks & library</strong> → <strong>Pick peaks</strong>. Peaks are labelled with their most likely
              functional group; the table below the chart lists all candidates.
            </DocLi>
          </DocOl>
          <DocNote>
            Press <DocCode>Ctrl K</DocCode> to find any setting by name or purpose, and <DocCode>F1</DocCode> on a
            control for its help.
          </DocNote>
        </>
      ),
    },
    {
      id: "files-workspace",
      title: "Files and workspace",
      keywords: ["upload", "open", "json", "workspace", "export", "jdx", "report"],
      body: (
        <DocUl>
          <DocLi>
            Opens <DocCode>.csv .txt .tsv .dx .jdx .spc</DocCode>; several at once. Absorbance or transmittance is
            detected from the file and can be changed under Preprocess → Mode.
          </DocLi>
          <DocLi>
            <strong>Save / Load workspace</strong> keeps the open spectra and all settings in a JSON file.
          </DocLi>
          <DocLi>
            <strong>Export peaks CSV</strong>, <strong>Export JDX</strong> (processed spectrum, absorbance) and{" "}
            <strong>Report HTML</strong> (settings and peak table) are in the header.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "reprocess",
      title: "Preprocess",
      keywords: ["baseline", "normalize", "smooth", "atr", "preset", "transmittance"],
      body: (
        <>
          <DocP>Changes apply to the chart straight away; use undo/redo next to the section title.</DocP>
          <DocUl>
            <DocLi>
              <strong>Mode</strong>: transmittance is converted to absorbance (A = −log₁₀T) before anything else, so
              heights, areas and fits are always in absorbance.
            </DocLi>
            <DocLi>
              <strong>Smoothing</strong>: Savitzky–Golay over N points (0 = off); larger windows broaden sharp bands.
            </DocLi>
            <DocLi>
              <strong>Baseline</strong>: airPLS (default) and AsLS follow a curved background; <strong>lambda</strong>{" "}
              sets how stiff it is (default 1e5). Rubberband uses the convex hull. Use <strong>Show baseline</strong>{" "}
              on the chart to check it stays under the peaks.
            </DocLi>
            <DocLi>
              <strong>Normalize</strong>: none for one sample; SNV or vector to compare samples.
            </DocLi>
            <DocLi>
              <strong>Mask CO₂</strong> skips 2310–2390 cm⁻¹ in peak picking. <strong>ATR correction</strong> is an
              approximate ν/ν_ref scaling, not a full optical correction.
            </DocLi>
          </DocUl>
        </>
      ),
    },
    {
      id: "peak-pick",
      title: "Peak picking",
      keywords: ["peak", "prominence", "derivative", "shoulder", "manual"],
      body: (
        <DocUl>
          <DocLi>
            <strong>Min prominence</strong> (default 0.01): raise it if you get too many small peaks.{" "}
            <strong>Min distance</strong> (8 cm⁻¹) stops one band being picked twice. <strong>Top N</strong> (15) keeps
            the most prominent.
          </DocLi>
          <DocLi>
            <strong>Shoulder mode</strong> also finds shoulders from second-derivative minima — useful in crowded
            regions such as amide I.
          </DocLi>
          <DocLi>
            Add or delete peaks by hand with the <strong>Peak tool</strong> on the chart (Inspect / Add / Delete);{" "}
            <strong>Clear manual</strong> undoes your edits.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "assignments",
      title: "Bond library assignment",
      keywords: ["library", "assign", "score", "functional group", "exclude", "ambiguous"],
      body: (
        <DocUl>
          <DocLi>
            With <strong>Assign bonds</strong> on, each peak gets candidate functional groups from the bundled library
            with a 0–100 score; candidates below <strong>min score</strong> (35) are hidden unless none pass.
          </DocLi>
          <DocLi>
            A label is set automatically only when the best candidate scores at least the{" "}
            <strong>ambiguity ratio</strong> (1.3×) of the runner-up; otherwise it's marked ambiguous.
          </DocLi>
          <DocLi>
            Rule out groups you know are absent with <strong>Exclude categories / subcategories</strong>, then{" "}
            <strong>Apply & re-label</strong>.
          </DocLi>
          <DocLi>Choose another candidate, type your own label or hide it in the peak table.</DocLi>
        </DocUl>
      ),
    },
    {
      id: "constraints-quant",
      title: "Deconvolution, integration, subtraction, matching",
      keywords: ["integration", "fit", "subtract", "deconvolution", "reference", "amide"],
      body: (
        <DocUl>
          <DocLi>
            <strong>Integrate</strong>: area, height, FWHM and position of a band between two wavenumbers, above a
            linear, horizontal or tangent baseline.
          </DocLi>
          <DocLi>
            <strong>Subtract</strong>: current − k × another spectrum; <strong>Auto-fit region</strong> finds k.
          </DocLi>
          <DocLi>
            <strong>Match references</strong>: ranks built-in reference spectra by correlation (on 1st derivatives by
            default); click a hit to overlay it.
          </DocLi>
          <DocLi>
            <strong>Deconvolute</strong>: fits 1–6 Gaussian, Lorentzian or Voigt components seeded from the second
            derivative and reports each one's area %. Presets cover amide I, carbonyl and O–H/N–H. If the fit does not
            converge you are told, and the numbers shown are only starting guesses.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "overlay",
      title: "Multi-overlay",
      keywords: ["overlay", "compare", "stack", "offset"],
      body: (
        <DocP>
          Tick spectra to draw them together (shortcut <DocCode>O</DocCode>): overlaid, offset, or stacked. With{" "}
          <strong>Pick on overlaid spectra</strong> peaks are picked on all of them; each gets its own tab in the peak
          table.
        </DocP>
      ),
    },
    {
      id: "spectrum-chart",
      title: "Spectrum chart",
      keywords: ["chart", "zoom", "region", "derivative", "design", "export"],
      body: (
        <DocUl>
          <DocLi>
            <strong>Region</strong> zooms to fingerprint, functional groups, amide I & II or your own range.
          </DocLi>
          <DocLi>
            <strong>2nd derivative</strong> overlays −d²A/dν² to reveal hidden bands; <strong>Show baseline</strong>{" "}
            draws the subtracted baseline.
          </DocLi>
          <DocLi>
            <strong>Design</strong>: line width, frame, grid, peak label colour and size, fonts, trace colours, and
            shaded functional-group regions (shortcut <DocCode>F</DocCode>).
          </DocLi>
          <DocLi>
            <strong>Export</strong>: 1:1 or journal size, SVG or PNG at the chosen DPI, white background.
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "peaks-table",
      title: "Peak table",
      keywords: ["table", "wavenumber", "prominence", "label", "copy"],
      body: (
        <DocP>
          Every picked peak with wavenumber, height, prominence, width, its top candidate and score. Filter by
          assignment, show low-confidence peaks, sort by a column, change or hide each label, and{" "}
          <strong>Copy CSV</strong> to paste into Excel.
        </DocP>
      ),
    },
    {
      id: "shortcuts",
      title: "Keyboard shortcuts",
      keywords: ["keyboard", "shortcut", "keys"],
      body: (
        <DocUl>
          <DocLi>
            <DocCode>P</DocCode> pick peaks · <DocCode>O</DocCode> overlay on/off · <DocCode>F</DocCode> functional-group
            regions
          </DocLi>
          <DocLi>
            <DocCode>[</DocCode> / <DocCode>]</DocCode> previous / next spectrum · <DocCode>Esc</DocCode> leave the
            add/delete peak tool
          </DocLi>
          <DocLi>
            <DocCode>Ctrl Z</DocCode> / <DocCode>Ctrl Y</DocCode> undo / redo settings
          </DocLi>
        </DocUl>
      ),
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      keywords: ["error", "parse", "empty", "no assignments"],
      body: (
        <DocUl>
          <DocLi>
            <strong>File refused</strong>: check the delimiter and that it has two numeric columns (wavenumber, signal).
          </DocLi>
          <DocLi>
            <strong>Flat or empty spectrum</strong>: try Baseline none and Normalize none, then add steps back.
          </DocLi>
          <DocLi>
            <strong>No assignments</strong>: turn on Assign bonds and lower the min score.
          </DocLi>
        </DocUl>
      ),
    },
  ],
};
