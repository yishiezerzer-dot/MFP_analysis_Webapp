# Publication Plot Export Roadmap

## Goal

Make FTIR and LCMS plot exports genuinely publication ready: deterministic final figure sizes, readable labels and strokes at print size, vector-first output, and consistent behavior across chart types.

This roadmap is intentionally written before implementation so the export behavior can be reviewed and agreed on first.

## Implementation Status

- Shared publication export pipeline: implemented.
- Toolbar with 90 x 60, 135 x 80, 180 x 100, and 180 x 120 mm presets plus manual width/height controls: implemented.
- PNG raster scaling via `scale = DPI / 96`: implemented.
- SVG vector export through the same off-screen pipeline: implemented.
- Vertical right-side legend reserve outside the chosen plot-area size: implemented.
- FTIR spectrum export: implemented.
- LCMS TIC, UV, EIC, MS1 spectrum, and Kendrick export: implemented.
- Help text and pure sizing tests: implemented.
- PDF export: still deferred to a future backend/headless export path.

## Current State

- FTIR has a new `Paper (180 mm)` export toolbar for SVG/PNG.
- LCMS has the same toolbar on the UV chromatogram only.
- Plate Reader also uses the shared toolbar, so the helper has already become cross-tab behavior.
- The shared helper converts physical width directly into Plotly `width` pixels at the selected DPI.
- Export height is inferred from the current responsive on-screen Plotly layout.

## Main Problems To Fix

1. DPI is being used as Plotly layout size.
   - At 180 mm and 300 DPI, the helper creates a logical width of about 2126 px.
   - Plotly font sizes and line widths are still specified in screen pixels, so labels and strokes become too small at final print size.
   - Correct behavior: use a logical layout size for design, then use `scale` to generate raster resolution.

2. SVG behavior is unclear.
   - SVG is vector, so DPI should not drive it the same way as PNG.
   - If the UI promises a physical width, the SVG should either contain physical dimensions or the UI should clearly label it as vector export.

3. Output depends on the current browser layout.
   - Current height comes from `_fullLayout.width/height`.
   - The exported figure changes when the user resizes the panel or browser.
   - Publication export should be deterministic from a selected preset.

4. LCMS export coverage is incomplete.
   - The paper toolbar exists on UV only.
   - Expected LCMS coverage: TIC, UV chromatogram, EIC, MS spectrum, and Kendrick plot.

5. Interactive rendering and export rendering are mixed.
   - FTIR was moved from `scattergl` to `scatter` to improve SVG export.
   - That is good for vector output, but export should ideally use export-specific traces/layouts so interactive performance is not forced to match export requirements.

## Publication Defaults

Use journal-neutral presets based on common publisher guidance.

### Figure Width Presets

| Preset | Width |
| --- | ---: |
| Single column | 90 mm |
| 1.5 column | 135 mm |
| Double column | 180 mm |

Default preset: `Double column 180 mm` for now, because it matches the current toolbar intent. Allow users to switch to single or 1.5 column.

### Aspect Ratio Presets

| Preset | Suggested use |
| --- | --- |
| 90 x 60 mm | Single FTIR spectrum, simple LCMS trace |
| 135 x 80 mm | Dense spectrum, annotated chromatogram, overlay |
| 180 x 100 mm | Wide chromatogram, multi-trace overlay |
| 180 x 120 mm | Dense labels or multipanel-ready export |

Implementation should expose width preset and height preset separately, with sensible defaults per chart type.

### Raster DPI Presets

| DPI | Use |
| ---: | --- |
| 300 | Color raster fallback or quick draft |
| 600 | Default PNG export for mixed line art and labels |
| 1200 | Pure line-art raster export when a journal requires raster |

Default PNG DPI: `600`.

### Typography And Strokes At Final Size

Use Arial or Helvetica.

| Element | Target final size |
| --- | ---: |
| Axis titles | 7-8 pt |
| Tick labels | 6-7 pt |
| Legend text | 6-7 pt |
| Peak labels | 6-7 pt |
| Panel labels, if added later | 8 pt bold |
| Main trace | 0.5-0.8 pt |
| Axes and ticks | 0.4-0.6 pt |
| Minimum visible line | 0.5 pt preferred |

## Recommended Technical Design

Build a shared export pipeline instead of adding more per-chart ad hoc calls to `Plotly.downloadImage`.

### New Shared Module

Create something like:

`web/frontend/src/utils/publicationPlotExport.ts`

Responsibilities:

- Define export presets.
- Convert physical size to logical Plotly size.
- Convert requested DPI to PNG scale.
- Clone Plotly data and layout.
- Apply export-only layout overrides.
- Render a temporary off-screen Plotly div.
- Call `Plotly.downloadImage` or `Plotly.toImage`.
- Purge the temporary div after export.
- Surface user-friendly errors for oversized canvas exports.

### Core Size Model

Use 96 px per inch as the logical CSS/Plotly design baseline.

For a width in millimeters:

```text
logicalWidthPx = widthMm / 25.4 * 96
logicalHeightPx = heightMm / 25.4 * 96
pngScale = dpi / 96
```

Example:

```text
180 mm wide at 600 DPI
logicalWidthPx = 680
pngScale = 6.25
final PNG width = 4252 px
```

This keeps Plotly fonts and line widths designed at normal logical sizes while still producing high-resolution raster output.

### Export Layout Rules

For publication export, override the on-screen layout with:

- `autosize: false`
- fixed `width` and `height`
- white `paper_bgcolor`
- white `plot_bgcolor`
- `font.family: "Arial, Helvetica, sans-serif"`
- explicit axis title/tick font sizes
- deterministic margins
- optional legend placement tuned for export
- no reliance on responsive container dimensions

### Export Data Rules

- Clone data before export.
- Prefer non-WebGL traces for vector export where practical.
- For FTIR spectra, LCMS TIC, UV, and EIC, use `scatter` line traces for SVG export.
- For centroid MS spectra, consider export-only stick/bar traces with controlled stroke width.
- If a chart uses WebGL in the future, warn that SVG may contain rasterized layers.

### Format Rules

SVG:

- Preferred for line plots, spectra, chromatograms, axes, labels, and annotations.
- DPI should not be shown as the main control for SVG.
- Include selected physical size in the filename.
- Optionally postprocess SVG dimensions to include `mm` width/height.

PNG:

- Use selected physical size plus selected DPI.
- Use `scale = dpi / 96`.
- Include width, height, and DPI in the filename.

PDF:

- Do not add browser PDF export in this pass.
- Treat PDF as a future server/headless pipeline, likely via Plotly/Kaleido or SVG-to-PDF conversion.

## UI Design

Replace the current `PaperFigureExportToolbar` with a slightly richer but still compact control.

Suggested controls:

- Size preset select: `90 mm`, `135 mm`, `180 mm`
- Height preset select or aspect ratio select
- Format buttons: `SVG`, `PNG`
- DPI select shown only for PNG
- Tooltip explaining that SVG is vector and PNG uses DPI

Keep the existing simple toolbar style, but avoid implying DPI applies equally to SVG.

## Chart Coverage

### Phase 1 - Shared Export Foundation

- Add export presets and helper functions.
- Add tests for size conversion and filename generation.
- Add off-screen Plotly export helper.
- Keep current visible export buttons working during transition.

Acceptance:

- 90, 135, and 180 mm presets produce expected logical sizes.
- PNG final pixels match selected DPI.
- SVG export does not depend on DPI.
- TypeScript build passes.

### Phase 2 - FTIR

- Convert FTIR paper export to the shared pipeline.
- Use export-specific layout for spectrum plots.
- Keep on-screen chart behavior unchanged as much as possible.
- Ensure overlays, difference spectra, reference traces, peak markers, labels, regions, and atmospheric bands export correctly.

Acceptance:

- FTIR SVG has readable axis titles/ticks at selected figure width.
- FTIR PNG has expected pixel dimensions for selected width/height/DPI.
- Export output does not change when the browser panel is resized.

### Phase 3 - LCMS Core Charts

- Add shared publication export to TIC.
- Replace UV paper export with shared pipeline.
- Add shared publication export to EIC charts, including overlay mode.
- Add shared publication export to MS spectrum charts.

Acceptance:

- TIC, UV, EIC, and MS spectrum exports all use the same presets.
- Single EIC and overlay EIC exports both work.
- MS spectrum export uses publication-appropriate stick/line widths.

### Phase 4 - Kendrick Plot

- Add publication export to the Kendrick dialog.
- Export current Kendrick x-axis mode, series coloring, annotations/hover-independent labels if any are visible.

Acceptance:

- Kendrick SVG/PNG export works from the dialog.
- Export respects selected axis mode and visible points/series.

### Phase 5 - Polish And Documentation

- Update FTIR and LCMS help pages.
- Add short explanation of vector vs PNG/DPI.
- Add visual smoke checks if practical.
- Consider adding a preview/readout such as `180 x 100 mm, PNG 600 DPI -> 4252 x 2362 px`.

Acceptance:

- Users can understand what size they are exporting before clicking.
- Help text matches actual behavior.
- No stale references to `Paper (180 mm)` as the only publication option.

## Testing Plan

Unit tests:

- millimeters to logical pixels
- DPI to scale
- final PNG pixel dimensions
- filename suffixes
- preset validation
- SVG ignores DPI for sizing

Manual smoke tests:

- FTIR single spectrum SVG
- FTIR overlay PNG at 600 DPI
- LCMS UV chromatogram SVG
- LCMS EIC overlay PNG
- LCMS MS spectrum SVG
- Kendrick SVG

Visual checks:

- Axis titles readable at final size.
- Tick labels readable.
- Lines not hairline-thin.
- Legend does not overlap data.
- Export dimensions stay stable after resizing browser.

## Open Decisions

1. Should the default width remain 180 mm, or should each chart default to a more journal-neutral width?
   - FTIR simple spectrum: likely 90 or 135 mm.
   - LCMS UV/TIC with labels: likely 135 or 180 mm.
   - Overlay and multipanel-ready plots: likely 180 mm.

2. Should users choose height directly, or choose aspect ratio?
   - Direct height is more predictable for publication.
   - Aspect ratio is simpler and harder to misuse.

3. Should SVG files be postprocessed to contain physical `mm` dimensions?
   - This is more faithful to the UI promise.
   - It adds a little implementation complexity.

4. Should PDF export be added later through the backend?
   - Recommended later, not in the first implementation pass.

## Suggested First Implementation Slice

Start with the shared size/export helper and FTIR only.

That lets us prove:

- size math is correct,
- SVG and PNG semantics are clean,
- off-screen export works,
- labels and strokes are readable,
- existing chart interactivity remains stable.

After FTIR is solid, LCMS chart coverage should be mostly wiring and chart-specific layout tuning.
