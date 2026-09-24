# UI refresh, stage 1: shared foundation + LCMS

Date: 2026-09-24 · Status: approved in brainstorming, awaiting spec review

## Goal

Make the app easier on the eyes for long sessions. The main problems are small text, dense panels and visual busyness. The day theme (white background) is what the lab uses most. The primary screen is a desktop monitor, with laptops (1366–1440 px) sometimes.

Evidence: the code audit and the live critique (2026-09-24) found:

- 170 of 224 visible text items on LCMS are 12 px or smaller;
- about 180 one-off 9–11 px font sizes;
- 167 hard-coded Tailwind palette colours;
- 63 emoji used as icons;
- status badges below contrast minimums (green badge 1.9:1, red 2.8:1, muted icon grey 2.9:1);
- LCMS charts only about 350–560 px wide at 1440 px, and the tools panel scrolls sideways;
- night theme: chart traces nearly invisible, and filled buttons 1.7:1.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| Density | Comfortable: 13 px body, 12 px labels, slightly more spacing |
| Toolbars | Line icons; one filled (primary) button per area; card status as a single grey caption line |
| LCMS layout | Below ~1600 px the nav and session list collapse to slim rails that open as overlays; the tools panel never scrolls horizontally. Desktop keeps today's structure |
| Font | IBM Plex Sans for UI; IBM Plex Mono for values (unchanged) |
| Day palette | Neutral grey (no blue cast); keep the existing blue accent |
| Charts | Theme-aware default trace/axis colours (a colour the user set wins); spectrum x-range fitted to data; overlapping peak labels hidden; SI axis numbers; 12 px axis text |
| Themes | Keep day and night. Fix night bugs and apply the new type, icons and font. **Remove night-vision**; a stored `night-vision` preference falls back to `day` |
| Rollout | Staged. Stage 1 = foundation + LCMS (this spec). Later stages: FTIR, then Plate Reader, Data Studio, Figures, AI |
| Primary Actions card | Merged into the tools panel |
| Tool tabs | Renamed "Analysis" and "Display" |

## Approach

Foundation first, then an LCMS pass. Change the tokens and shared classes once so every tab picks them up. Then sweep the LCMS files for one-off sizes, hard-coded colours and emoji, and add the layout collapse. The rejected alternatives were a component-library rewrite (too much churn for a lab tool) and a global font bump (keeps the busyness and the bad colours).

## 1. Foundation (all tabs)

### 1.1 Day tokens (`src/styles.css`, `:root, [data-theme="day"]`)

The neutral ramp replaces the cool blue-grey `--ink-*` ramp:

| Token | Value | Use |
|---|---|---|
| `--ink-50` | `#fafafa` | raised surface |
| `--ink-100` | `#f4f4f5` | canvas, subtle fills |
| `--ink-200` | `#e4e4e7` | borders |
| `--ink-300` | `#d4d4d8` | strong borders |
| `--ink-400` | `#a1a1aa` | disabled / decorative only, **never text** |
| `--ink-500` | `#63636d` | muted text, icons (5.9:1 on white, 5.4:1 on canvas) |
| `--ink-600` | `#52525b` | section labels (7.7:1) |
| `--ink-700` | `#3f3f46` | body text (10.4:1) |
| `--ink-800` | `#27272a` | control text |
| `--ink-900` | `#18181b` | headings (17.7:1) |

- `--canvas` = `#f4f4f5`, `--surface` = `#ffffff`, `--surface-raised` = `#fafafa`.
- `--brand-*` is unchanged (accent `#405a9c`, 6.6:1).

Semantic text tokens are added next to the existing fill/surface tokens:

- `--success-fg` `#047857` on `--success-surface` `#ecfdf5` (5.2:1)
- `--warning-fg` `#b45309` on `#fffbeb` (4.8:1)
- `--danger-fg` `#b91c1c` on `#fef2f2` (5.9:1)
- `--info-fg` = `--brand-700`

`--on-brand` is new: the text colour on filled brand buttons. It is white in day.

All of these are exposed in `tailwind.config.js` (`success-fg`, `on-brand`, …).

### 1.2 Night tokens

The existing night palette is kept. Additions:

- `--on-brand` is dark navy (`#0b1530`), which fixes white-on-pale-blue buttons at 1.7:1.
- Lighter `-fg` status tokens: `#6ee7b7`, `#fcd34d`, `#fca5a5`.
- The Plotly background matches `--surface` instead of the lighter `#001a37`.

Night-palette desaturation is out of scope.

### 1.3 Remove night-vision

- Delete the `[data-theme="night-vision"]` block, its entry in `ThemeProvider.tsx` and the theme switcher in `layout/UserMenu.tsx`.
- `ThemeProvider` maps a stored `night-vision` to `day`.

### 1.4 Typography

- Google Fonts import: IBM Plex Sans (400/500/600) + IBM Plex Mono (400/500). Instrument Sans is removed, including the explicit `font-family: 'Instrument Sans'` rules inside `styles.css` classes.
- Tailwind `fontFamily.sans` → IBM Plex Sans.
- Base body font size is 13 px.

The scale, defined as named classes in `styles.css` (no arbitrary sizes in stage-1 files):

| Class | Size / weight | Replaces |
|---|---|---|
| `.text-page-title` | 18 / 600 | page header titles |
| `.text-card-title` | 15 / 600 | chart and panel card titles (today 13–14) |
| `.text-body` | 13 / 400 | controls, body |
| `.text-section` | 12 / 600, ink-600, sentence case | `.text-heading` (10 px uppercase tracked) |
| `.text-caption` | 12 / 400, ink-500 | status lines, hints (today 10–11 px) |
| `.text-mono-val` | Plex Mono 13 | numeric values |

The floor is 12 px for all UI text. `.text-heading` is kept as an alias of `.text-section` until later stages migrate their files.

### 1.5 Buttons, chips, status

- `.btn-primary`: filled brand with `--on-brand` text. **At most one per area** (card toolbar, dialog footer, tools-panel section group, page header).
- `.btn` (secondary): outlined.
- `.btn-ghost` (quiet): transparent, used for card-toolbar actions.
- `.btn-danger`: `--danger-fg` on `--danger-surface`.
- All buttons are at least 28 px tall.
- `.badge-*` and `.status-dot.*` use the semantic `-fg`/`-surface` tokens, which fixes the 1.9:1 and 2.8:1 failures.
- A new `.chip-accent` (brand-50 / brand-800) is used for polymer and other feature chips. This replaces hard-coded purple.
- Segmented controls use `.pill-group` / `.pill-item`. The hand-rolled copy in `ToolsPanel.tsx` (DatasetRibbon) is replaced.

### 1.6 Icons

- Add the `lucide-react` dependency. Icons are 15 px, stroke 1.8, `currentColor`.
- An `Icon` wrapper is not needed; use lucide components directly.
- Emoji used as icons in stage-1 files are replaced.
- Emoji inside user-generated text are not touched.

### 1.7 Chart defaults (all Plotly charts; `usePlotlyTheme` in `ThemeProvider.tsx`)

`usePlotlyTheme` returns:

- `fontColor` (ink-600), `gridColor` (ink-200), `zeroLineColor` (ink-300), `paper_bgcolor` = `plot_bgcolor` = surface;
- `traceDefault` (brand-600 day / brand-400 night);
- `font.size` 12, tick font 12.

Trace colours:

- A trace uses `traceDefault` unless the user set a colour.
- In `lcms/settings.ts` the stored defaults `#1e2636` (TIC) and `#323c50` (spectrum) are treated as "not user-set". Stored settings equal to those old defaults also resolve to the theme colour.
- FTIRView and PlateReaderView hard-coded trace defaults get the same treatment, limited to replacing the default value only.

Axis numbers use SI suffixes (`exponentformat: "SI"`), e.g. 3M rather than 3e+6.

**Export isolation:** `utils/publicationPlotExport.ts` and SinglePlotDesignDialog keep their own explicit fonts and colours. An export with the same settings must produce the same figure as before.

## 2. LCMS pass

### 2.1 Page header

- The title is followed by a single caption status line: file · MS1 scans · RT range · polarities · UV. This replaces the DatasetRibbon card.
- Help (ghost), Load/Save workspace (secondary), **Open mzML…** (primary).

### 2.2 Layout (`views/LCMSView.tsx`, `App.tsx` sidebar, `components/lcms/SessionsSidebar.tsx`)

- **At 1600 px or wider:** today's structure (nav, sessions list, main, tools).
- **Below 1600 px:**
  - The nav uses its existing collapsed rail. The auto-collapse breakpoint moves from 767 px to 1600 px, and the pinned state is ignored below the breakpoint.
  - The sessions list collapses to a 44 px rail showing an icon + "Sessions · N". Click opens it as an overlay above the charts; clicking outside or Esc closes it.
  - The tools panel has a fixed width of 290 px, `overflow-x: hidden`, and its contents wrap.
- The main column gets `min-width: 0`, so charts take all remaining width.

### 2.3 Chart cards (TIC, EIC, UV, MS1; `components/lcms/*Chart.tsx`)

- The card header is `.text-card-title` + a `.text-caption` status line (for example "RT 22.46 min · ESI+ · 1 polymer match · 2,332 peaks"). It replaces the coloured chips.
- Toolbar actions (Zoom, Labels, Design, Reload, Export) are `.btn-ghost` with lucide icons.
- The MS1 primary is Polymer Studio; Deconvolute is secondary.

MS1 spectrum:

- **Default x-range:** [min m/z − 5%, max m/z + 10%] of the displayed peaks, recomputed when the spectrum changes, unless the user zoomed or set axis limits in Design.
- **Label collisions:** labels sorted by intensity; a label is hidden if its box overlaps an already-placed label, using an estimate of 7 px per character at 12 px font. Hidden labels stay in the hover text. Polymer labels win over plain m/z labels.

### 2.4 Tools panel (`components/lcms/ToolsPanel.tsx`)

- The tabs are renamed **Analysis** and **Display**.
- Analysis tab sections, with `.text-section` labels:
  - Scan navigation (Prev/Next/First/Last, all secondary, plus the keyboard tip as a caption);
  - Chromatograms (**EIC…** primary, Find m/z…);
  - Jump to RT;
  - Spectrum peak labels;
  - Polymer & reaction matching;
  - Region;
  - Tables & plots (Feature table, Comparison, Kendrick, Export labels).
- The **Primary Actions card is removed**. Its actions move into the sections above, with no loss of function.
- The Display tab keeps its current controls, including the "Show polymer/confidence/alignment controls" checkboxes.

### 2.5 Dialogs used by LCMS

- The Polymer Studio monomer rows get a name column of at least 10rem. Abbreviations get 4.5rem.
- In stage-1 dialogs, one-off sizes (`text-[10px]`/`[11px]`) are replaced by the scale classes, and emoji in titles and buttons by lucide icons or plain text.

## 3. Out of scope for stage 1

- FTIR, Plate Reader, Data Studio, Figures and AI view-specific passes. They receive only the foundation changes, and may look mixed until their stage.
- Night-palette redesign.
- Any change to analysis results, saved sessions, workspaces or exported figure styling.

## 4. Verification

- `tsc` type-check, all frontend tests, and `npm run build` pass.
- **New unit tests:**
  - theme trace-colour resolution: user colour wins, and the old stored defaults map to the theme colour;
  - spectrum default x-range;
  - label collision filter: deterministic, highest intensity kept, polymer priority;
  - `night-vision` → `day` fallback;
  - export settings unchanged, meaning the publication export still produces the same layout fonts and colours for the same settings.
- **Automated sweep over stage-1 files:**
  - no `text-[9px]`/`[10px]`/`[11px]`;
  - no raw Tailwind palette colours (`amber-`, `red-`, `rose-`, `emerald-`, `purple-`, `sky-`, `blue-`);
  - no emoji icons;
  - no `text-ink-400` on text.
- **Contrast check** of every text/background token pair in both themes: at least 4.5:1.
- **Screenshots** of LCMS before and after, at 1920 and 1440 px, in day and night. The user approves them before merge.
- One merge to `main`; the user then checks on Railway.

## 5. Risks

- Other tabs use one-off styles and may look inconsistent until their stage. This is cosmetic only.
- Users who saved night-vision see day on next load.
- Changing default trace colours affects only charts using the old defaults. User-chosen colours and exports are unaffected.
