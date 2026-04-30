# PLAN.md — MFP Analysis Webapp: UI/UX Overhaul

> **Living document.** Update as work progresses. Branches: `main` (stable) → `design-overhaul` (active).

---

## Status Snapshot — What Is Already Done

> Do **not** redo these. They landed on the `design-overhaul` branch.

| File | What Changed |
|------|-------------|
| `src/styles.css` | Full rewrite: deep-blue-black night palette, Inter + IBM Plex Mono fonts, `.card`, `.btn-*`, `.input`, `.nav-item`, `.pill-group`, `.badge`, `.session-item`, `.data-table`, `.panel-section`, `.drop-zone`, scrollbars |
| `tailwind.config.js` | Inter/IBM Plex Mono, custom `shadow-card/sm/md/lg` |
| `src/App.tsx` | 56 px collapsed sidebar, smaller icons, tighter nav text |
| `src/layout/PageHeader.tsx` | Fixed h-12, tighter typography |
| `src/layout/UserMenu.tsx` | Theme-aware surface backgrounds, tighter popover, updated ThemeSwatch night palette |
| `src/theme/ThemeProvider.tsx` | `usePlotlyTheme()` hook: per-theme `plot_bgcolor`, `paper_bgcolor`, `fontColor`, `gridColor`, `legendBg`, `zerolineColor` |
| `src/views/LCMSView.tsx` | Plotly bgcolor wired to `usePlotlyTheme()` |
| `src/views/FTIRView.tsx` | Plotly bgcolor wired |
| `src/views/PlateReaderView.tsx` | Plotly bgcolor wired |
| `src/views/DataStudioView.tsx` | Plotly bgcolor wired |
| `src/components/Toast.tsx` | Per-kind border, `rounded-[8px]`, tighter text |
| `src/components/EmptyState.tsx` | Updated card style and typography |

---

## Design Principles

**"Precision Lab"** — clean, quiet, scientific, readable. Dense but navigable.

- Semantic tokens everywhere: no literal `#ffffff`/`#000000`/`bg-white` in themed surfaces.
- Three themes: **Day** (light), **Night** (deep blue-black), **Night Vision** (red/amber lab).
- WCAG AA contrast minimum for all body text.
- No marketing aesthetics. Keep info-dense layouts; improve their readability.
- Reusable shared components over duplicated local patterns.
- Work in stages: each phase produces a clean build. Never leave the app broken.

---

## Phase 1 — Critical Dark-Mode Fixes (Quick Wins)

**Risk:** Low. These are 1–4 line changes per occurrence but have high visual impact in Night theme.

### 1A — Add `surface`, `canvas`, `surface-raised` as Tailwind colors

Currently these are CSS variables but not Tailwind utilities. Add to `tailwind.config.js`:

```js
colors: {
  // ... existing ink/brand ...
  canvas:          "rgb(var(--canvas) / <alpha-value>)",
  surface:         "rgb(var(--surface) / <alpha-value>)",
  "surface-raised":"rgb(var(--surface-raised) / <alpha-value>)",
}
```

This lets us write `bg-surface`, `bg-canvas`, `bg-surface-raised` as Tailwind classes.

### 1B — Replace `bg-white` on session cards and bubbles

Audit found `bg-white` (not dark-theme-aware) in:

| Location | Element | Fix |
|----------|---------|-----|
| `FTIRView.tsx` | Active session card | `bg-surface shadow-card` |
| `PlateReaderView.tsx` | Active session card | `bg-surface shadow-card` |
| `DataStudioView.tsx` | Active session card | `bg-surface shadow-card` |
| `DataStudioView.tsx` | Inactive Y-column toggle | `bg-surface ring-1 ring-ink-200` |
| `AIView.tsx` | Assistant chat bubble | `bg-surface text-ink-900` |
| `AIView.tsx` | Provider pill (unselected) | `bg-surface text-ink-700` |

### 1C — Add semantic alert tokens to `styles.css`

Add per theme in `styles.css` (using the same RGB-triplet pattern as existing tokens):

```css
/* success/warning/danger/info — for banners, badges, status dots */
--success:         16 185 129;   /* emerald-500   */
--success-surface: 236 253 245;  /* emerald-50    */
--warning:         245 158 11;   /* amber-500     */
--warning-surface: 255 251 235;  /* amber-50      */
--danger:          239 68 68;    /* red-500       */
--danger-surface:  254 242 242;  /* red-50        */
--info:            59 130 246;   /* blue-500      */
--info-surface:    239 246 255;  /* blue-50       */
```

Night / Night-Vision overrides (darker surfaces, lighter on-colors for readability):
```css
[data-theme="night"] {
  --success-surface: 6 78 59;
  --warning-surface: 78 44 3;
  --danger-surface:  69 10 10;
  --info-surface:    23 37 84;
}
```

Wire in `tailwind.config.js`:
```js
success: "rgb(var(--success) / <alpha-value>)",
"success-surface": "rgb(var(--success-surface) / <alpha-value>)",
// warning, danger, info equivalents
```

### 1D — Add `colorway` to `usePlotlyTheme()`

Overlay trace colors are currently hardcoded hex arrays that don't change with theme. Add to `PlotlyThemeColors`:

```ts
colorway: string[];
```

Values:
```ts
day:           ["#3559A8","#0F766E","#B45309","#7C3AED","#BE123C","#0891B2"]
night:         ["#7290E8","#5EEAD4","#FCD34D","#C4B5FD","#FDA4AF","#67E8F9"]
"night-vision":["#FF6B6B","#FFB347","#FFEAA7","#FF9F80","#FFB3BA","#FFDAB9"]
```

Wire to Plotly `layout.colorway` in each view **only when no user-custom trace colors override it**. In FTIR overlay, use `pt.colorway[i]` as the default but keep the per-trace color picker.

**Files:** `theme/ThemeProvider.tsx`, then `FTIRView.tsx`, `LCMSView.tsx`, `DataStudioView.tsx`.

**Acceptance for Phase 1:**
- `npm run lint` and `npm run build` pass.
- Night theme has no white session cards or bubbles.
- Chart traces have legible colors in all 3 themes.

---

## Phase 2 — Shared UI Components

**Risk:** Medium. New files only. No edits to existing logic.

Create `src/components/` additions:

### Tooltip upgrade — `src/components/Tooltip.tsx`

Current version: portal + position calc. Needs:
- Dismiss on: click, mouse-leave, Escape key, blur, disabled state change.
- Placement prop: `"top" | "bottom" | "left" | "right"` (default `"top"`).
- Show delay: 400 ms. Hide delay: 0 ms (instant).
- `aria-describedby` linkage between trigger and tooltip.
- Works even when button is `disabled` (use `pointer-events: none` on wrapper, relay via parent `onMouseEnter`/`onMouseLeave`).
- Max-width: 200 px, wraps text.
- Z-index: `z-[9999]` (above Plotly modebars).

**Key pattern for disabled buttons:**
```tsx
// Wrap a disabled button in a <span> that receives mouse events
<span onMouseEnter/Leave to drive tooltip>
  <button disabled .../>
</span>
```

### AlertBanner — `src/components/AlertBanner.tsx`

```tsx
interface AlertBannerProps {
  kind: "error" | "warning" | "info" | "success";
  message: string;
  detail?: string;          // collapsible technical detail
  onDismiss?: () => void;
  onRetry?: () => void;
  action?: { label: string; onClick: () => void };
  className?: string;
}
```

Replaces inline red/amber divs in all views. Uses `--danger-surface`/`--warning-surface` tokens. Has `aria-live="assertive"` for errors, `"polite"` for info.

### Spinner — `src/components/Spinner.tsx`

Simple animated spinner SVG. Props: `size?: "sm" | "md" | "lg"`, `label?: string`.
Used for: button loading states, chart loading overlays, panel loading states.

### Button wrapper — `src/components/ui/Button.tsx`

Thin wrapper around existing `.btn` CSS classes with first-class support for:
```tsx
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger" | "subtle";
  size?: "sm" | "md";
  loading?: boolean;
  loadingText?: string;        // e.g. "Exporting…" instead of "Working…"
  disabledReason?: string;     // tooltip shown when disabled
  tooltip?: string;            // tooltip when enabled
  icon?: ReactNode;            // leading icon
}
```

When `disabled && disabledReason`: wraps in `<span>` and shows tooltip with reason.
When `loading`: shows `<Spinner size="sm"/>` + `loadingText`.

### IconButton — `src/components/ui/IconButton.tsx`

For icon-only actions (close, copy, remove, export icons). Always requires `aria-label`. Always supports `tooltip`. Sizes: `sm` (h-6 w-6), `md` (h-8 w-8).

### ChartPanel — `src/components/ChartPanel.tsx`

Consistent chart wrapper:
```tsx
interface ChartPanelProps {
  title?: string;
  actions?: ReactNode;        // export buttons etc.
  loading?: boolean;
  loadingText?: string;
  empty?: boolean;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  children: ReactNode;        // the Plotly chart
  className?: string;
}
```

Reuses existing `usePlotlyAutoResize` (from `App.tsx` context). Shows `Spinner` overlay when loading. Shows `EmptyState` when no data.

**Acceptance for Phase 2:**
- All new files pass `tsc --noEmit`.
- Existing views compile unchanged (no forced migration yet).
- Tooltip dismisses correctly on all triggers.
- AlertBanner renders all 4 kinds correctly in Day and Night themes.

---

## Phase 3 — App Shell Polish

**Files:** `src/App.tsx`, `src/layout/PageHeader.tsx`, `src/layout/UserMenu.tsx`

### App.tsx
- Replace native `title` attribute on collapsed nav items with shared `<Tooltip>` component.
- Replace native `title` on pin button with `<Tooltip>`.
- If header action area overflows narrow widths, add `overflow-x: auto` guard or `flex-wrap`.

### PageHeader.tsx
- Add `aria-label="Page header"` to outer nav.

### UserMenu.tsx  
- Add `text-ink-500` to settings/admin icon colors (interrupted last session).
- All existing logic and layout stays as-is.

**Acceptance:** No regression. Nav tooltips work on keyboard focus.

---

## Phase 4 — FTIR View Polish

**File:** `src/views/FTIRView.tsx` (~1696 lines)  
**Risk:** Medium-low. Well-structured.

Specific changes:
1. Session card `bg-white` → `bg-surface shadow-card` *(Phase 1B prerequisite)*
2. Axis color `#475569` → `rgb(var(--ink-500))` in chart layout
3. Text annotation color `#46536a` → `rgb(var(--ink-600))`
4. Overlay palette → use `pt.colorway[i]` as per-trace default; keep user color picker override
5. Replace inline error div → `<AlertBanner kind="error" .../>`
6. Workspace missing-sessions warning → `<AlertBanner kind="warning" .../>`
7. Tooltips on: Load workspace, Save workspace, Export peaks CSV, Export SVG/PNG, Graph settings toggle
8. `disabledReason` on: Export CSV ("No peaks found yet"), Export SVG/PNG ("Load a spectrum first")
9. Loading text specificity: "Loading spectrum…" (already good), "Picking peaks…" for peak computation
10. Empty state: improve with supported formats (`.spa`, `.csv`, `.txt`, `.dpt`)
11. Peak table: add sort-by column click for wavenumber / prominence
12. Graph settings card: add "Reset to defaults" button

**Acceptance:** All existing FTIR functionality intact. Overlay colors change with theme.

---

## Phase 5 — Plate Reader View Polish

**File:** `src/views/PlateReaderView.tsx` (~1360 lines)  
**Risk:** Medium.

Specific changes:
1. Session card `bg-white` → `bg-surface shadow-card`
2. MIC chart series default colors: expose as per-theme constants
   - Day: sample `#3559A8`, control `#475569`, blank `#B45309`
   - Night: sample `#7290E8`, control `#A9B6CA`, blank `#FCD34D`
3. Row role buttons `S`/`C`/`B`/`-`: add `tooltip` with full labels — "Sample row", "Control row", "Blank row", "Unused"
4. `disabledReason` on Run MIC: "Select at least one sample row and one or more concentration columns"
5. Concentration column header toggle: tooltip "Click to include as a concentration point"
6. Reverse cols button: tooltip "Swap concentration column order (ascending ↔ descending)"
7. Auto numeric cols: tooltip "Automatically detect columns containing numbers"
8. Replace error div → `<AlertBanner kind="error"/>`
9. Warning if no control rows: `<AlertBanner kind="warning" message="No control rows selected — results may be unreliable"/>`
10. Export buttons (CSV, JSON, PNG, SVG): available from start but disabled with reason "Run MIC analysis first"
11. Blank subtraction checkbox: tooltip "Subtract the mean of blank rows from all measurements before computing MIC"
12. Clear button: tooltip "Remove all data and settings for this session"

**Acceptance:** Full MIC workflow runs. Row role buttons legible without abbreviation knowledge.

---

## Phase 6 — Data Studio View Polish

**File:** `src/views/DataStudioView.tsx` (~1351 lines)  
**Risk:** Medium.

Specific changes:
1. Session card `bg-white` → `bg-surface shadow-card`
2. Inactive Y-column toggle: `bg-surface ring-1 ring-ink-200`
3. Replace error div → `<AlertBanner kind="error"/>`
4. Transform warning box → `<AlertBanner kind="warning" detail={warnings.join("\n")}/>`
5. User-facing transform names (display only; backend keys unchanged):
   - `select_columns` → "Select / Drop Columns"
   - `rename` → "Rename Columns"
   - `to_numeric` → "Convert to Numbers"
   - `fillna` → "Fill Missing Values"
   - `normalize` → "Normalize"
   - `baseline` → "Baseline Correction"
   - `log` → "Log Transform"
   - `rolling_mean` → "Smoothing (Rolling Mean)"
6. Per-transform tooltip descriptions (1–2 sentence explanations shown on hover/focus of the transform header)
7. Chart empty states by cause (use `EmptyState` with specific messages):
   - No file: "Open a table to get started"
   - No numeric columns: "Add a 'Convert to Numbers' step to your pipeline"
   - No Y selected: "Select one or more columns to plot"
   - Empty rows after transforms: "Your pipeline produced no rows — check filter settings"
8. Histogram: hide/disable X-column selector (irrelevant for histogram; show tooltip explaining)
9. Undo button tooltip: "Undo last transform change" or disabledReason "Nothing to undo"
10. Clear all tooltip: "Remove all transforms (cannot be undone)"
11. `disabledReason` on Add-transform buttons if no table loaded: "Open a table first"

**Acceptance:** Non-developer can read and use transforms. Chart always explains its empty state.

---

## Phase 7 — AI Assistant View Polish

**File:** `src/views/AIView.tsx` (~823 lines)  
**Risk:** Lower. No charts.

Specific changes:
1. Assistant bubble: `bg-white text-ink-800` → `bg-surface text-ink-900` (dark mode fix)
2. Provider pill (unselected): `bg-white text-ink-700` → `bg-surface text-ink-700`
3. Copy-message hover: `hover:bg-ink-100 hover:text-ink-700` → already ok in dark mode; verify
4. TypingIndicator dots: `bg-ink-400` → fine; verify Night Vision
5. Replace inline error div → `<AlertBanner kind="error" .../>`
6. "No datasets loaded" empty state: add navigation links — "Go to LCMS", "Go to FTIR", etc. using router `<Link>`
7. Tooltip on: download transcript ("Export conversation as .txt"), clear chat ("Clear all messages"), copy message ("Copy to clipboard"), refresh context ("Refresh loaded sessions")
8. `disabledReason` on clear chat: "No messages to clear"
9. Provider limitation banners: replace terse inline text with `<AlertBanner kind="info" message="Demo mode — replies are pre-written; no network calls made"/>`
10. Left sidebar panel: add collapse toggle (chevron button) for narrow widths
11. Session context list: add file-size/shape hint in tooltip: "N rows × M columns"

**Acceptance:** No white bubbles in Night theme. Provider states are clear.

---

## Phase 8 — LCMS View Polish (Staged)

**File:** `src/views/LCMSView.tsx` (~1000+ lines)  
**Risk:** Highest. Staged approach mandatory.

### Stage 8A — Safe, Non-Functional Changes (first commit)
1. Replace loading text "Working…" with specific labels ("Loading session…", "Exporting…", "Matching polymers…")
2. Replace error div → `<AlertBanner kind="error"/>`
3. Add `colorway: pt.colorway` to TIC, EIC, UV, Spectrum chart layouts
4. Tooltips on all toolbar buttons: open file, load workspace, save workspace, export TIC/EIC/UV/spectrum PNG/SVG/CSV, overlay toggle, label toggle, polymer match, zoom, pan, etc.
5. `disabledReason` on disabled controls: "Load a session first", "No spectrum selected", "Select a session to enable overlays", etc.

### Stage 8B — Panel Layout Improvements (second commit)
1. Group tools rail into labeled sections: Spectrum | Labels | Overlays | Export
2. "Coming soon" controls: add meaningful disabledReason or hide
3. Chart affordance hints: small muted text below TIC "Click to set retention time", near labels "Drag labels to reposition"

### Stage 8C — Component Migration (third commit, only after 8A+8B validated)
1. Migrate largest repeated button patterns to `<Button>` and `<IconButton>` components
2. Wrap main charts in `<ChartPanel>` for consistent loading/empty/export UX

**Between each stage:** Run lint + build. Verify TIC click, EIC window, UV chromatogram, spectrum, overlays, polymer matching, workspace save/load still work.

**Acceptance per stage:** Build passes. Existing workflow intact. More tooltips with each stage.

---

## Phase 9 — QA Pass

After all phases:

```bash
npm.cmd --prefix MFP_analysis_app/web/frontend run lint
npm.cmd --prefix MFP_analysis_app/web/frontend run build
```

Manual checklist:
- [ ] All 5 routes load without console errors
- [ ] Day theme: all text readable, no contrast failures
- [ ] Night theme: no white panels, no white bubbles, no contrast failures
- [ ] Night Vision theme: readable
- [ ] Sidebar collapsed and expanded — nav, tooltips, user menu work
- [ ] All major buttons have tooltips
- [ ] Disabled buttons show disabled reason tooltips
- [ ] Empty states are informative with next action
- [ ] Chart trace colors adapt to theme (colorway)
- [ ] File upload works: LCMS, FTIR, Plate Reader, Data Studio
- [ ] Export works: all views
- [ ] Workspace save/load: LCMS, FTIR, Plate Reader
- [ ] Toasts appear for success actions
- [ ] AlertBanner appears for errors with dismiss
- [ ] Keyboard: all interactive elements reachable by Tab
- [ ] Focus rings visible in all themes

---

## Full File Modification Scope

| File | Phase | Change Type |
|------|-------|-------------|
| `tailwind.config.js` | 1 | Add `surface`/`canvas`/semantic color utilities |
| `src/styles.css` | 1 | Add `--success`/`--warning`/`--danger`/`--info` tokens |
| `src/theme/ThemeProvider.tsx` | 1 | Add `colorway` to `usePlotlyTheme()` |
| `src/components/Tooltip.tsx` | 2 | Upgrade: placement, dismiss, ARIA |
| `src/components/AlertBanner.tsx` | 2 | **New** component |
| `src/components/Spinner.tsx` | 2 | **New** component |
| `src/components/ChartPanel.tsx` | 2 | **New** component |
| `src/components/ui/Button.tsx` | 2 | **New** component |
| `src/components/ui/IconButton.tsx` | 2 | **New** component |
| `src/App.tsx` | 3 | Custom Tooltip on nav/pin |
| `src/layout/PageHeader.tsx` | 3 | ARIA label |
| `src/layout/UserMenu.tsx` | 3 | Icon color minor fix |
| `src/views/FTIRView.tsx` | 4 | Dark-mode fix + tooltips + UX |
| `src/views/PlateReaderView.tsx` | 5 | Dark-mode fix + tooltips + UX |
| `src/views/DataStudioView.tsx` | 6 | Dark-mode fix + tooltips + UX |
| `src/views/AIView.tsx` | 7 | Dark-mode fix + tooltips + UX |
| `src/views/LCMSView.tsx` | 8 | Staged: tooltips → layout → components |

**NOT modified:** Any file under `backend/`, `api.ts`, `mfp-logo.png`, `main.tsx`

---

## Key Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| LCMS regression (largest file, most state) | Stage into 3 separate commits; type-check after each |
| CSS variable additions breaking existing Tailwind | Add new variables only; never rename `--ink-*` or `--brand-*` |
| Tooltip z-index clashing with Plotly modebar | Use `z-[9999]`; test chart hover interactions after |
| `bg-surface` colliding with something in Tailwind | Verify via `npm run build`; prefix with `bg-canvas-` if collision |
| Chart colorway change breaking user color pickers | Apply `colorway` only as default; user picker overrides per-trace `marker.color` |
| DataStudio transform display names confusing backend | Display-name mapping purely in UI render; backend keys unchanged |
| Disabled button tooltip (HTML `disabled` blocks mouse events) | Wrap in `<span>` as relay |
| Night Vision theme contrast after semantic token changes | Test Night Vision after Phase 1C; adjust per-theme `--danger-surface` etc. if needed |

---

## Assumptions

- No backend API changes.
- Existing React/Tailwind/Vite stack; no new UI framework.
- Icons: continue inline SVG pattern (already established). No new icon library.
- Semantic tokens use the existing `r g b` triplet pattern for Tailwind alpha support.
- TypeScript strict mode must continue to pass after every phase.
- `bg-white` → `bg-surface` migration happens **only on themed surfaces** (not on intentionally white elements like the day-theme form inputs which are correctly white).
