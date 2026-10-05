import type { HelpModule } from "../types";
import { DocCode, DocH4, DocLead, DocLi, DocNote, DocOl, DocP, DocUl, DocWalkthrough } from "../docPrimitives";
import micGif from "../media/workflow-mic.gif";
import paperGif from "../media/workflow-paper.gif";

export const plateReaderHelpModule: HelpModule = {
  title: "Plate Reader — help",
  topics: [
    {
      id: "overview",
      title: "Overview",
      keywords: ["mic", "plate", "gen5", "biotek"],
      body: (
        <>
          <DocLead>
            Open a BioTek Gen5 plate export, say which wells are which on the plate map, and read the MIC by eye from
            the % growth charts. Every number can be traced back to the wells it came from.
          </DocLead>
          <DocWalkthrough src={micGif} caption="Guide me → Analyse a MIC plate, on the example LacGlyDOH plate" />
          <DocOl>
            <DocLi>
              <strong>Open plate…</strong> (or drop the file on the page).
            </DocLi>
            <DocLi>
              <strong>Plate map</strong>: check the layout (it is filled from your Gen5 notes when they exist), click
              any bad well to exclude it.
            </DocLi>
            <DocLi>
              <strong>Results</strong>: heatmap, dose–response, % growth, stick plot and the results table, all at
              once.
            </DocLi>
            <DocLi>
              <strong>Experiment</strong>: give plates the same experiment tag (e.g. the polymer plate and the
              gentamicin plate) to see them together.
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
      id: "files",
      title: "Files",
      keywords: ["xlsx", "csv", "gen5", "notes", "metadata"],
      body: (
        <>
          <DocP>
            Accepts <DocCode>.xlsx .xlsm .xls .csv .tsv .txt</DocCode>. The reader looks for the 8×12 block labelled
            1–12 across and A–H down, so any sheet with such a block works; Gen5 exports also give the reader, date,
            read type, wavelength and temperature.
          </DocP>
          <DocP>
            Notes typed under the plate in Gen5, such as <DocCode>A-C - LacGlyDOH 5:1:1</DocCode> or{" "}
            <DocCode>rows D–F: gentamicin</DocCode>, become compounds on the plate map.
          </DocP>
          <DocNote>A file without an 8×12 block is refused with “No 8×12 plate block found”.</DocNote>
        </>
      ),
    },
    {
      id: "plate-map",
      title: "Plate map",
      keywords: ["layout", "paint", "exclude", "template", "growth control", "blank", "dilution"],
      body: (
        <>
          <DocP>
            Each well shows its OD, shaded white → blue. The ring colour is its role: a compound, growth control (dark)
            or blank (grey). Column headers show the concentration of each column.
          </DocP>
          <DocH4>Layout panel</DocH4>
          <DocUl>
            <DocLi>
              <strong>Dilution series</strong>: top concentration (column 1, default 1024 µg/mL, remembered), unit,
              factor (÷2) and the columns it runs over (1–11).
            </DocLi>
            <DocLi>
              <strong>Compounds</strong>: a name and the rows it fills, e.g. <DocCode>A–C</DocCode>. Use{" "}
              <strong>Reference</strong> for gentamicin.
            </DocLi>
            <DocLi>
              <strong>Controls</strong>: the growth-control column (12) and optional blank rows (e.g.{" "}
              <DocCode>G–H</DocCode>).
            </DocLi>
            <DocLi>
              <strong>Apply to plate</strong> fills the plate from the form; excluded wells are kept.
            </DocLi>
            <DocLi>
              <strong>Save as template</strong> stores the layout for the whole lab; pick it from{" "}
              <strong>Template</strong> on the next plate.
            </DocLi>
          </DocUl>
          <DocH4>On the plate</DocH4>
          <DocUl>
            <DocLi>
              <strong>Click a well</strong> to exclude it (hatched) or include it again, e.g. a growth-control well that
              did not grow.
            </DocLi>
            <DocLi>
              <strong>Pick a group</strong> under the plate, then <strong>drag across wells</strong> to move them to it.{" "}
              <strong>Esc</strong> cancels a drag.
            </DocLi>
          </DocUl>
          <DocNote>The layout is saved automatically for each plate.</DocNote>
        </>
      ),
    },
    {
      id: "calculation",
      title: "How the numbers are calculated",
      keywords: ["blank", "growth", "percent", "sd", "formula", "workbook"],
      body: (
        <>
          <DocOl>
            <DocLi>Blank = mean OD of the blank wells (0 when there are none or Subtract blank is off).</DocLi>
            <DocLi>Each well: OD − blank.</DocLi>
            <DocLi>
              Growth control = mean of the growth-control wells in the compound's own rows (all growth-control wells on
              the plate if its rows have none).
            </DocLi>
            <DocLi>Per concentration: mean, SD (n − 1) and n of the compound's replicate wells.</DocLi>
            <DocLi>% growth = 100 × mean ÷ growth control.</DocLi>
          </DocOl>
          <DocP>
            Excluded wells are left out of every step. <strong>Calculation workbook</strong> (Results tab) downloads an
            Excel file that redoes all of this with live formulas from the raw plate.
          </DocP>
          <DocP>
            Every chart has <strong>How is this calculated?</strong> with this plate's wells and numbers, the checks
            and the steps to reproduce it in Excel.
          </DocP>
        </>
      ),
    },
    {
      id: "checks",
      title: "Checks",
      keywords: ["warning", "cv", "contaminated", "replicate"],
      body: (
        <DocUl>
          <DocLi>Growth control grew: at least 0.2 OD above the blank.</DocLi>
          <DocLi>Growth-control wells agree (CV ≤ 20%); a well below half of the others is flagged as inhibited.</DocLi>
          <DocLi>Blank is low (≤ 0.1) and even.</DocLi>
          <DocLi>Replicates agree at each concentration (CV ≤ 20%); the check names the row that deviates.</DocLi>
          <DocLi>No OD above the reader's reliable range (2.5).</DocLi>
          <DocLi>Whether growth falls below 10% within the tested range.</DocLi>
        </DocUl>
      ),
    },
    {
      id: "results",
      title: "Results and exports",
      keywords: ["dose", "stick", "4pl", "ic50", "csv", "export", "design"],
      body: (
        <>
          <DocUl>
            <DocLi>
              <strong>Dose–response</strong>: mean ± SD on a log₂ concentration axis; dashed = growth control.
            </DocLi>
            <DocLi>
              <strong>% growth</strong>: relative to the growth control; dashed = 100%.
            </DocLi>
            <DocLi>
              <strong>Stick plot</strong>: bars per concentration in plate order with the growth control last.
            </DocLi>
            <DocLi>
              <strong>4PL fit</strong> (optional): IC₅₀ ± SE, Hill slope and R²; an IC₅₀ outside the tested range is
              marked “do not report”.
            </DocLi>
            <DocLi>
              <strong>Results table</strong>: every replicate, n, mean, SD and % growth, as CSV or Excel.
            </DocLi>
          </DocUl>
          <DocP>
            <strong>Design</strong> sets the title and axis labels; <strong>Export</strong> saves a publication figure
            (SVG or PNG at the chosen size and DPI).
          </DocP>
        </>
      ),
    },
    {
      id: "experiment",
      title: "Experiment",
      keywords: ["tag", "combine", "grid", "si package"],
      body: (
        <>
          <DocWalkthrough src={paperGif} caption="Prepare for paper (experiment tag menu): charts at a journal size and the SI package" />
          <DocP>
            Plates with the same experiment tag are combined. Each compound is compared with the growth control on its
            own plate, so a gentamicin plate and a sample plate can be read side by side.
          </DocP>
          <DocUl>
            <DocLi>
              <strong>MIC reading grid</strong>: % growth for the mean and every replicate; read the MIC where the
              colour turns white.
            </DocLi>
            <DocLi>
              <strong>Export all (Excel)</strong>: the grid plus every plate's calculation sheets.
            </DocLi>
            <DocLi>
              <strong>Download SI package</strong>: methods, tables and provenance for the whole experiment.
            </DocLi>
          </DocUl>
        </>
      ),
    },
  ],
};
