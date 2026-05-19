# Cross-language LCMS analysis fixtures

JSON fixture files in this directory are read by **both** the TypeScript Vitest
suite (`web/frontend/src/lcms/__tests__/cross_language_fixtures.test.ts`) and
the Python pytest suite
(`web/backend/tests/test_cross_language_fixtures.py`).

Each fixture file follows this shape:

```json
{
  "cases": [
    {
      "name": "short description of the case",
      "input": { ...canonical snake_case input... },
      "expected": { ...field-level assertions, snake_case... }
    }
  ]
}
```

The TS adapter translates camelCase fields to snake_case before asserting, so
fixtures stay language-neutral. Numeric assertions use a tolerance of 1e-6
(more than enough for IEEE-754 determinism across the same algorithm).

## Why these exist

The three algorithms below are duplicated across TS (frontend `analysis.ts`)
and Python (backend `app/automation/actions/*.py`). Any algorithmic change in
one language must produce the same output in the other or one of these tests
fails — so the duplication can't silently drift between phases.

| Fixture file | TS function | Python function |
|---|---|---|
| `integrate_eic_peak.json` | `integrateEICPeak` | `integrate_eic_peak` |
| `kendrick.json` | `buildKendrickPoints` | `build_kendrick_points` |
| `comparison_matrix.json` | `groupFeatureRowsForMatrix` | `group_feature_rows_for_matrix` |

If you add a new shared algorithm, drop a fixture here and wire both test files
to load it.
