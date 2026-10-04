import type { ControlTab } from "./controls";

// Short guided tours; each step points at a control in the registry (help/controls.ts), so a step
// keeps working when the control moves to another panel.
export interface TourStep {
  control: string;
  title: string;
  text: string;
}

export interface Tour {
  id: string;
  tab: ControlTab;
  title: string;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    id: "lcms",
    tab: "lcms",
    title: "LCMS in one minute",
    steps: [
      { control: "lcms.open", title: "Open your run", text: "Open one or more mzML files, or drop them anywhere on the page. No file to hand? Use Try with example data." },
      { control: "lcms.polarity", title: "Pick the polarity", text: "Show ESI+ or ESI− scans. Polymer matching needs one of the two, not All." },
      { control: "lcms.scanNav", title: "Move through the run", text: "Click the TIC to open a scan, or step with these buttons and the ← → keys." },
      { control: "lcms.eic", title: "Follow one mass", text: "An EIC shows when one m/z elutes; integrate it for area and apex time." },
      { control: "lcms.polymerDialog", title: "Label a polymer series", text: "Tick your monomers here; matching peaks get labels like 2-GA + 1-LA." },
      { control: "lcms.toolsSection", title: "Analysis and Display", text: "Analysis holds the tools above; Display holds units, panels, overlays and CSV exports." },
      { control: "app.findControl", title: "Find anything", text: "Press Ctrl+K and type what you want to do. Hover any control for a hint, F1 for its help." },
    ],
  },
  {
    id: "ftir",
    tab: "ftir",
    title: "FTIR in one minute",
    steps: [
      { control: "ftir.open", title: "Open spectra", text: "CSV, TXT, JCAMP-DX or SPC, several at once. No file to hand? Use Try with example data." },
      { control: "ftir.preset", title: "Start from a preset", text: "Pick your sample type (KBr disc, ATR, polymer film) to set smoothing, baseline and normalisation." },
      { control: "ftir.baseline", title: "Check the baseline", text: "airPLS follows curved backgrounds; switch on Show baseline on the chart to see it stays under the peaks." },
      { control: "ftir.pickPeaks", title: "Pick peaks", text: "Finds peaks and labels them with likely functional groups from the bond library." },
      { control: "ftir.region", title: "Zoom to a region", text: "Jump to the fingerprint, functional-group or amide region, or your own range." },
      { control: "ftir.deconvolute", title: "Go further", text: "Integrate bands, subtract spectra, match references or deconvolute amide I in Deconvolution." },
      { control: "app.findControl", title: "Find anything", text: "Press Ctrl+K and type what you want to do. Hover any control for a hint, F1 for its help." },
    ],
  },
  {
    id: "plate-reader",
    tab: "plate-reader",
    title: "Plate Reader in one minute",
    steps: [
      { control: "plate.open", title: "Open a plate", text: "A BioTek Gen5 export or any 8×12 sheet. Notes typed in Gen5 fill the layout. No file? Try the example plates." },
      { control: "plate.template", title: "Reuse a layout", text: "Pick a saved template, or fill the form below once and save it for the lab." },
      { control: "plate.compoundRows", title: "Say where each compound is", text: "Type the rows of each compound (e.g. A–C), the growth-control column and blank rows, then Apply." },
      { control: "plate.grid", title: "Fix the plate by hand", text: "Click a well to exclude it (e.g. a contaminated growth control); drag to reassign wells." },
      { control: "plate.view", title: "Read the results", text: "Results shows % growth, dose–response and the table; Experiment combines plates with the same tag." },
      { control: "plate.explain", title: "Check the maths", text: "Every chart explains how it was calculated with this plate's wells, and what the checks found." },
      { control: "app.findControl", title: "Find anything", text: "Press Ctrl+K and type what you want to do. Hover any control for a hint, F1 for its help." },
    ],
  },
  {
    id: "ai",
    tab: "ai",
    title: "AI Assistant in one minute",
    steps: [
      { control: "ai.provider", title: "Choose a provider", text: "Demo works offline but only matches keywords; pick OpenAI, Anthropic or a local Ollama model for real answers." },
      { control: "ai.includeContext", title: "Share your data", text: "With context on, the assistant sees a short summary of your open files." },
      { control: "ai.autoExecute", title: "Stay in control", text: "Actions that change things wait for your Approve unless you allow safe ones to run on their own." },
      { control: "ai.starters", title: "Start with an example", text: "Click a question to send it, or type your own below." },
      { control: "ai.message", title: "Ask or instruct", text: "Ask about your data, or ask it to do something, like creating an EIC." },
    ],
  },
];

const BY_ID = new Map(TOURS.map((t) => [t.id, t]));
const BY_TAB = new Map(TOURS.map((t) => [t.tab, t]));

export function getTour(id: string): Tour | undefined {
  return BY_ID.get(id);
}

export function tourForTab(tab: ControlTab | null): Tour | undefined {
  return tab ? BY_TAB.get(tab) : undefined;
}
