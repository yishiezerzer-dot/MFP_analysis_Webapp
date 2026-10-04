# Easier for new users: help, hints, control finder, start page, tours, guided workflows

Date: 2026-10-04 · Status: approved by the user (2026-10-04)

## Goal

New lab members know the science (MIC, LCMS, FTIR) but not this app. Today they don't know where to start, don't understand what a control does, and above all **can't find the control they need**. Make every control explained and findable, give a clear starting point, and let common analyses run from a button that asks a few questions.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| Audience | New lab members: help explains the app, not the science |
| Biggest problem | Finding a control they need or want to use; also where to start and what controls do |
| Finding controls | **Search box (Ctrl+K)** that jumps to the control and highlights it; also searches help |
| Hints | **Every control** gets a hover hint: what it does + typical value, with a link to the help topic |
| Tour | Offered, not forced: "Take the 1-minute tour?" on the first visit to a tab; replay from Help |
| Start page | **Home page with task cards** + recent files; returning users may open on their last tab |
| Example data | "Try with example data" per tab, using the repo's test files (the two Gen5 plates, LCMS/FTIR fixtures), labelled *Example* |
| Automations | **Guided workflows**: step-by-step dialog, one question per step, default + "I don't know", summary before it runs, answers remembered |
| Workflows | MIC plate (first), LCMS find my product, FTIR identify peaks, Prepare for paper |
| LCMS inputs | Monomers / repeat unit, expected product mass, ionisation & adducts |
| Walkthroughs | Recorded GIFs made by Claude in the browser, added to the help drawer, recorded last |
| Language | English only |
| Order | Foundation first: stage 1 → 2 → 3 → 4, each merged on its own |

## Stage 1: correct help, hints everywhere, control finder

### 1.1 Control registry (`src/help/controls.ts`)

One typed list, the single source for hints, the finder, tours and "Show me":

```ts
interface ControlHint {
  id: string;            // "ftir.preprocess.baselineLambda"
  tab: "lcms" | "ftir" | "plate-reader" | "ai" | "app";
  label: string;         // "Baseline lambda"
  what: string;          // "How stiff the fitted baseline is. Higher = smoother."
  typical?: string;      // "1e5–1e7"
  keywords?: string[];   // extra search words: ["background", "asls"]
  panel?: string;        // which panel/section must be open, e.g. "ftir.inspector.preprocess"
  helpTopic?: string;    // help topic id in the tab's help module
}
```

- Text style: `what` is one sentence, plain words; `typical` is a value or range, or the default when there is no typical range.
- Every interactive control on every tab has an entry. Buttons whose label already says everything (e.g. "Cancel") are exempt and listed in an `EXEMPT` set so the coverage test stays honest.

### 1.2 Hints in the UI

- `<Hint id="…">child</Hint>` wraps a control: renders the existing `Tooltip` with *label — what · Typical: …* and a "More in Help" link when `helpTopic` is set, and marks the wrapper with `data-control="<id>"` so the finder and tours can locate it.
- Existing ad-hoc `title=` texts on controls are replaced by `<Hint>`; `aria-label`s stay.
- Delay 400 ms (current Tooltip default); keyboard focus also shows the hint.

### 1.3 Find a control (Ctrl+K)

- A search field in the page header ("Find a control… Ctrl K") opens a command-palette dialog; Ctrl+K / ⌘K anywhere opens it.
- Results: controls of the current tab first, then other tabs, then help topics. Matching on label, `what`, keywords (case- and accent-insensitive, word-prefix match).
- Enter on a control: navigate to its tab if needed → ask the view to open `panel` (see 1.4) → scroll the `[data-control]` element into view → flash a brand-coloured outline for ~1.5 s → focus it when focusable. Enter on a help topic opens the help drawer at that topic.
- If a control is not on screen because no file is open (e.g. FTIR peak settings with no spectrum), the result says "Open a file first" and offers *Try with example data* once stage 2 exists.

### 1.4 Revealing controls in closed panels

- A small reveal bus: `useRevealPanel(handlers: Record<string, () => void>)` in each view registers how to open its panels (FTIR inspector section, LCMS tools-panel tab, Plate Reader tab, collapsed cards). The finder calls the handler for the control's `panel`, waits two animation frames, then scrolls/flashes.

### 1.5 Help drawer fixes

- Audit LCMS, FTIR and AI help against the current UI; remove or rewrite stale topics (old workspace buttons, removed panels, native prompt/confirm notes).
- Each topic may list related control ids; the topic shows **Show me** buttons that use the finder's reveal.

### 1.6 Tests

- Coverage: every `<Hint id>` / `data-control` id used in the source exists in the registry, and every registry id is used somewhere (via `import.meta.glob(..., { query: "?raw" })` over `src/**/*.tsx`).
- Registry: unique ids, non-empty `what`, `helpTopic` exists in that tab's help module, `panel` has a reveal handler name listed per view.
- Finder: search ranking (current tab first, label match before `what` match) and the reveal sequence (pure functions).

## Stage 2: getting started

- **Home page** (`/`): "What do you want to do?" task cards (each starts its guided workflow once stage 3 exists; until then opens the tab), recent files across tabs, links to tours. Setting: *Open on: Home | last tab* (default Home for new browsers).
- **Example data:** a "Try with example data" button on each tab's empty state and in the Home cards. Backend: `GET /api/examples` lists bundled files; `POST /api/examples/{id}/open` creates a normal session from a copy, with display name prefixed "Example – " and experiment tag `Example`. Files: the two Gen5 plates (with their layouts preset), one LCMS mzML fixture, one FTIR fixture.
- **Better empty states** on every tab: what the tab is for, accepted files, Try example, Take the tour.
- **Tours:** per tab, 5–7 steps, each step points at a control id (so a moved control doesn't break it), dims the page except the target, Next/Back/Skip, Esc closes. First visit to a tab shows the offer card once (remembered per browser); replay from Help and Home.

## Stage 3: guided workflows

Shared dialog: one question per step with a default, an "I don't know" link that explains the choice, Back/Next, and a final **This will:** summary before running. Answers are saved (per browser) as next time's defaults. After running, the user lands on the result with a toast listing what was done and how to undo/adjust.

1. **Analyse a MIC plate:** file (or example) → compounds and rows (pre-filled from Gen5 notes) → top concentration and dilution → growth-control column, blank rows → reference: on this plate / on another plate (tags both with the same experiment tag) → summary → apply layout, open Results.
2. **LCMS: find my product:** file → what do you know: monomers/repeat unit, or target mass → ionisation (ESI+/−), adducts, charges → summary → set up polymer / expected-products search, EICs, spectrum labels.
3. **FTIR: identify peaks:** file → sample type (film, KBr, ATR, solution) → preset → peak picking → library assignment → summary of top assignments.
4. **Prepare for paper:** experiment tag → journal / figure width → exports each chart at that size (SVG + PNG), CSV tables, and the SI package.

Each workflow gets its own short spec section and plan when its stage starts.

## Stage 4: recorded walkthroughs

Claude records one GIF per workflow (and one per tour) in the browser with the example data, stored under `public/help/` and shown in the matching help topic. Recorded after stages 1–3 are merged; re-recorded when the UI of that flow changes.

## Out of scope

- Hebrew / other languages.
- Narrated video.
- AI-driven workflows (the AI tab may call the guided workflows later).
- Per-user server-side preferences (browser storage only).

## Risks

- Hints need upkeep: the coverage test fails when a control is added without a registry entry.
- Tours and GIFs can go stale; tours reference control ids, GIFs are recorded last.
- Recording needs the dev servers; the machine has run low on memory, so close other programs first.
