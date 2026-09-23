# Changelog

## Unreleased

### Results affected

Re-check analyses made before these fixes if they relied on the items below.

- **LCMS polymer / expected-product labels for charge ≥ 2** (plan 1.1). Multiply charged ions were predicted as `(M + 1·H)/z` instead of `(M + z·H)/z`, so real `[M+2H]²⁺`/`[M+3H]³⁺` ions went unlabelled and labels read `[M+H]²⁺`. Na/K/Cl/formate/acetate adducts are now matched at z = 1 only (previously also at z > 1 with a single adduct mass). Affects spectrum labels and the Expected Products table whenever the charges field included values above 1.

### Removed

- SI package export (`/api/publication/si-package`) is disabled: it wrote placeholder numbers and a fixed methods text instead of real results. It will be rebuilt from stored analysis results (plan Phase 5). **Any SI package downloaded before this change should not be used.**
