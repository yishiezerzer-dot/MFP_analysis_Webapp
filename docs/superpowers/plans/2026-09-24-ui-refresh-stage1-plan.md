# UI refresh stage 1: build plan

Spec: `docs/superpowers/specs/2026-09-24-ui-refresh-stage1-design.md` · Branch: `design/ui-refresh-stage1`

Each task is one commit. After each task, `tsc` and `vitest` pass.

**Status (2026-09-24):** tasks 0–7 are done and committed; task 8 is waiting for the user to approve the screenshots before merge.

0. **Before screenshots**: LCMS in day and night, saved to the scratchpad. Check: images exist.
1. **Tokens, fonts, themes** (`styles.css`, `tailwind.config.js`, `ThemeProvider.tsx`, `UserMenu.tsx`)
   - Changes: neutral day ramp; `-fg`/`on-brand` tokens; night additions; night-vision removed with fallback; IBM Plex Sans; type-scale classes; button/badge/status/label classes on tokens.
   - Check: a test for the `night-vision`→`day` fallback, and a script that checks contrast of every token pair.
2. **Chart defaults** (`ThemeProvider.tsx` `usePlotlyTheme`, `lcms/settings.ts`, LCMS charts, FTIR/PlateReader defaults)
   - Changes: `traceDefault`, 12 px fonts, SI exponent, trace-colour resolver.
   - Check: resolver tests (user colour wins; old defaults resolve to the theme colour); export test shows identical output.
3. **Icons** (`lucide-react`): replace emoji in LCMS files; card toolbars use `.btn-ghost`; one primary per area.
   - Check: the sweep finds no emoji in stage-1 files.
4. **LCMS header and tools panel**
   - Changes: the status line replaces DatasetRibbon; Primary Actions merged into the tools panel; tabs renamed Analysis/Display; tools panel 290 px with no horizontal scroll.
   - Check: the existing LCMS tests pass, and a live check shows every former Primary Actions button still works.
5. **Laptop layout**: nav auto-collapses below 1600 px; sessions rail + overlay.
   - Check: live check at 1440 px (rails, overlay opens and closes with Esc) and at 1920 px (unchanged).
6. **Spectrum defaults**: fitted x-range; label-collision filter.
   - Check: unit tests for range and collisions; live check on the leucine file.
7. **LCMS sweep**
   - Changes: remove arbitrary 9–11 px sizes, raw palette colours and `text-ink-400` on text in stage-1 files; widen the Polymer Studio name column.
   - Check: the sweep script shows zero hits.
8. **Verify and merge**
   - Full `tsc`, `vitest` and `build`; backend tests unaffected.
   - After screenshots at 1920 and 1440 px, day and night; the user approves; CHANGELOG entry; merge; CI green.
