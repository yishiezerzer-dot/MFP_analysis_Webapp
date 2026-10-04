// One entry per control: the hover hint, the Ctrl+K finder, tours and "Show me" all read this list.
// A test fails when a control in the UI has no entry here, or an entry is not used in the UI.

export type ControlTab = "lcms" | "ftir" | "plate-reader" | "ai" | "app";

export interface ControlHint {
  id: string;
  tab: ControlTab;
  label: string;
  what: string;
  typical?: string;
  keywords?: string[];
  // A panel/section that must be opened before the control is visible (see useRevealPanel).
  panel?: string;
  helpTopic?: string;
}

export const TAB_ROUTES: Record<ControlTab, string | null> = {
  lcms: "/lcms",
  ftir: "/ftir",
  "plate-reader": "/plate-reader",
  ai: "/ai",
  app: null,
};

export const TAB_LABELS: Record<ControlTab, string> = {
  lcms: "LCMS",
  ftir: "FTIR",
  "plate-reader": "Plate Reader",
  ai: "AI Assistant",
  app: "Everywhere",
};

export const CONTROLS: ControlHint[] = [
  {
    id: "app.help",
    tab: "app",
    label: "Help",
    what: "Opens the guide for this tab: what each part does, how results are calculated, and troubleshooting.",
    keywords: ["manual", "guide", "documentation", "f1"],
  },
  {
    id: "app.findControl",
    tab: "app",
    label: "Find a control",
    what: "Search every button and setting by name or purpose; Enter jumps to it and highlights it.",
    typical: "Ctrl+K (⌘K on a Mac)",
    keywords: ["search", "command", "where", "locate"],
  },
  {
    id: "app.experimentTag",
    tab: "app",
    label: "Experiment tag",
    what: "Groups files that belong to one experiment; tagged plates are combined in the Experiment view and the SI package.",
    typical: "e.g. \"MIC run 12\"",
    keywords: ["group", "link", "si package", "label"],
  },
  {
    id: "app.exportFigure",
    tab: "app",
    label: "Export figure",
    what: "Saves the chart for a paper or slides: 1:1 as on screen, or at a journal width, as SVG (vector) or PNG at the chosen DPI.",
    typical: "SVG, single column 85 mm, 600 DPI for PNG",
    keywords: ["save", "image", "png", "svg", "publication", "download"],
  },

  // Plate Reader
  {
    id: "plate.open",
    tab: "plate-reader",
    label: "Open plate",
    what: "Loads a BioTek Gen5 export or any sheet/CSV with an 8×12 block labelled A–H and 1–12. You can also drop files on the page.",
    typical: ".xlsx from Gen5",
    keywords: ["upload", "import", "file", "gen5", "excel"],
    helpTopic: "files",
  },
  {
    id: "plate.view",
    tab: "plate-reader",
    label: "Plate map / Results / Experiment",
    what: "Plate map sets which wells are which; Results shows this plate's charts; Experiment combines plates with the same tag.",
    keywords: ["tabs", "switch", "view"],
    helpTopic: "overview",
  },
  {
    id: "plate.grid",
    tab: "plate-reader",
    label: "Plate wells",
    what: "Each well shows its OD. Click a well to exclude or include it; with a group picked below, drag across wells to assign them.",
    keywords: ["well", "exclude", "include", "contaminated", "paint", "drag", "od"],
    panel: "plate.tab.map",
    helpTopic: "plate-map",
  },
  {
    id: "plate.paint",
    tab: "plate-reader",
    label: "Paint wells as",
    what: "Pick a compound, growth control, blank or unassigned, then drag across wells on the plate to give them that role.",
    keywords: ["assign", "brush", "role", "group", "drag"],
    panel: "plate.tab.map",
    helpTopic: "plate-map",
  },
  {
    id: "plate.template",
    tab: "plate-reader",
    label: "Template",
    what: "Applies a saved layout (compounds, dilution, controls) to this plate. Templates are shared by the whole lab.",
    keywords: ["preset", "saved layout", "load"],
    panel: "plate.tab.map",
    helpTopic: "plate-map",
  },
  {
    id: "plate.deleteTemplate",
    tab: "plate-reader",
    label: "Delete template",
    what: "Removes the selected template for everyone in the lab. Plates already using it keep their layout.",
    keywords: ["remove template"],
    panel: "plate.tab.map",
  },
  {
    id: "plate.top",
    tab: "plate-reader",
    label: "Top concentration",
    what: "Concentration in the first dilution column; each next column is divided by the factor. Remembered for the next plate.",
    typical: "1024 µg/mL",
    keywords: ["highest", "start", "concentration", "dose"],
    panel: "plate.tab.map",
    helpTopic: "plate-map",
  },
  {
    id: "plate.unit",
    tab: "plate-reader",
    label: "Unit",
    what: "Concentration unit shown on the plate, charts, tables and exports.",
    typical: "µg/mL",
    panel: "plate.tab.map",
  },
  {
    id: "plate.direction",
    tab: "plate-reader",
    label: "Direction",
    what: "Whether the dilution series runs across columns (compounds in rows) or down rows (compounds in columns).",
    typical: "Across columns",
    keywords: ["orientation", "rows", "columns"],
    panel: "plate.tab.map",
  },
  {
    id: "plate.factor",
    tab: "plate-reader",
    label: "Dilution factor",
    what: "How much each step is diluted from the one before.",
    typical: "÷2 (two-fold dilution)",
    keywords: ["serial", "two-fold", "step"],
    panel: "plate.tab.map",
  },
  {
    id: "plate.range",
    tab: "plate-reader",
    label: "Dilution columns",
    what: "First (top concentration) and last column of the dilution series.",
    typical: "1 to 11 (column 12 = growth control)",
    keywords: ["from", "to", "first", "last"],
    panel: "plate.tab.map",
  },
  {
    id: "plate.compoundName",
    tab: "plate-reader",
    label: "Compound name",
    what: "Name used on charts, tables, exports and the Experiment view.",
    keywords: ["rename", "sample", "polymer"],
    panel: "plate.tab.map",
  },
  {
    id: "plate.compoundRows",
    tab: "plate-reader",
    label: "Compound rows",
    what: "The replicate rows this compound fills, as a range or list. Press Apply to update the plate.",
    typical: "A–C",
    keywords: ["replicates", "lines", "where"],
    panel: "plate.tab.map",
    helpTopic: "plate-map",
  },
  {
    id: "plate.compoundKind",
    tab: "plate-reader",
    label: "Kind",
    what: "Sample for the compounds you test; Reference for a known antibiotic such as gentamicin, marked as reference in charts.",
    typical: "Sample",
    keywords: ["reference", "control antibiotic", "gentamicin"],
    panel: "plate.tab.map",
  },
  {
    id: "plate.removeCompound",
    tab: "plate-reader",
    label: "Remove compound",
    what: "Takes the compound out of the form; its wells become unassigned after Apply.",
    panel: "plate.tab.map",
  },
  {
    id: "plate.addCompound",
    tab: "plate-reader",
    label: "Add compound",
    what: "Adds a sample compound to the form; type its rows, then press Apply.",
    keywords: ["new compound", "sample"],
    panel: "plate.tab.map",
  },
  {
    id: "plate.addReference",
    tab: "plate-reader",
    label: "Add reference",
    what: "Adds a reference antibiotic (named Gentamicin by default) to the form, for a control on the same plate.",
    keywords: ["gentamicin", "antibiotic", "positive control"],
    panel: "plate.tab.map",
  },
  {
    id: "plate.growthControl",
    tab: "plate-reader",
    label: "Growth control column",
    what: "Wells with bacteria and no compound: 100% growth. Each compound uses the growth-control wells in its own rows.",
    typical: "12",
    keywords: ["gc", "positive", "untreated", "100%"],
    panel: "plate.tab.map",
    helpTopic: "calculation",
  },
  {
    id: "plate.blank",
    tab: "plate-reader",
    label: "Blank rows",
    what: "Medium-only wells; their mean OD is subtracted from every well. Leave empty when the plate has no blank.",
    typical: "G–H",
    keywords: ["background", "medium", "sterile", "subtract"],
    panel: "plate.tab.map",
    helpTopic: "calculation",
  },
  {
    id: "plate.apply",
    tab: "plate-reader",
    label: "Apply to plate",
    what: "Fills the plate from the form (compound rows, growth control, blank). Excluded wells stay excluded.",
    keywords: ["update", "fill", "layout"],
    panel: "plate.tab.map",
    helpTopic: "plate-map",
  },
  {
    id: "plate.saveTemplate",
    tab: "plate-reader",
    label: "Save as template",
    what: "Saves this plate's layout (without excluded wells) under a name, for anyone in the lab to apply to other plates.",
    keywords: ["preset", "reuse", "store layout"],
    panel: "plate.tab.map",
  },
  {
    id: "plate.subtractBlank",
    tab: "plate-reader",
    label: "Subtract blank",
    what: "Subtracts the mean OD of the blank wells from every well before averaging. Off: values are OD as read.",
    typical: "On when the plate has blank wells",
    keywords: ["background", "baseline", "medium"],
    panel: "plate.tab.results",
    helpTopic: "calculation",
  },
  {
    id: "plate.fit4pl",
    tab: "plate-reader",
    label: "4PL fit (IC₅₀)",
    what: "Fits a 4-parameter logistic curve to each compound's means and reports IC₅₀ ± SE, Hill slope and R².",
    typical: "Off; only meaningful when growth drops within the tested range",
    keywords: ["ic50", "sigmoid", "logistic", "curve", "hill"],
    panel: "plate.tab.results",
    helpTopic: "results",
  },
  {
    id: "plate.workbook",
    tab: "plate-reader",
    label: "Calculation workbook",
    what: "Excel file that redoes every step with live formulas from the raw plate, so you can check or change the numbers.",
    keywords: ["excel", "xlsx", "formulas", "audit", "reproduce"],
    panel: "plate.tab.results",
    helpTopic: "calculation",
  },
  {
    id: "plate.explain",
    tab: "plate-reader",
    label: "How is this calculated?",
    what: "Shows how this chart was calculated with this plate's wells and numbers, the automatic checks, and Excel steps to redo it.",
    keywords: ["explain", "method", "why", "checks", "trust"],
    panel: "plate.tab.results",
    helpTopic: "calculation",
  },
  {
    id: "plate.design",
    tab: "plate-reader",
    label: "Design",
    what: "Sets the chart title and axis labels used on screen and in exports.",
    keywords: ["title", "axis", "label", "style"],
    panel: "plate.tab.results",
  },
  {
    id: "plate.plateCsv",
    tab: "plate-reader",
    label: "Plate CSV",
    what: "Downloads the 8×12 plate as read (raw OD) as a CSV file.",
    keywords: ["raw", "download", "export"],
    panel: "plate.tab.results",
  },
  {
    id: "plate.resultsCsv",
    tab: "plate-reader",
    label: "Results CSV",
    what: "Downloads the results table: every replicate, n, mean, SD and % growth per compound and concentration.",
    keywords: ["table", "download", "export", "data"],
    panel: "plate.tab.results",
    helpTopic: "results",
  },
  {
    id: "plate.siPackage",
    tab: "plate-reader",
    label: "Download SI package",
    what: "Zip with methods text, tables and provenance for every plate with this experiment tag, for a paper's supporting information.",
    keywords: ["supporting information", "zip", "paper", "methods"],
    panel: "plate.tab.experiment",
    helpTopic: "experiment",
  },
  {
    id: "plate.exportAll",
    tab: "plate-reader",
    label: "Export all (Excel)",
    what: "One workbook with the MIC reading grid plus every plate's calculation sheets with live formulas.",
    keywords: ["excel", "xlsx", "workbook", "experiment"],
    panel: "plate.tab.experiment",
    helpTopic: "experiment",
  },
  {
    id: "plate.gridCsv",
    tab: "plate-reader",
    label: "MIC grid CSV",
    what: "Downloads the % growth per concentration for every compound's mean and replicates.",
    keywords: ["mic", "reading grid", "download"],
    panel: "plate.tab.experiment",
  },
];

const BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));

export function getControl(id: string): ControlHint | undefined {
  return BY_ID.get(id);
}

export function tabOfRoute(pathname: string): ControlTab | null {
  const base = pathname.replace(/\/$/, "");
  const hit = (Object.keys(TAB_ROUTES) as ControlTab[]).find((t) => TAB_ROUTES[t] === base);
  return hit ?? null;
}
