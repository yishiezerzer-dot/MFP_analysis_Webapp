# Easier for new users: build plan

Spec: `docs/superpowers/specs/2026-10-04-onboarding-help-design.md` · Branch: `design/onboarding-help`

One commit per task. Frontend `tsc`, `vitest` and `build` (and backend `pytest` when touched) pass after every task. Each stage is merged to main on its own after a live check and the user's review.

## Stage 1: correct help, hints everywhere, control finder

1. **Registry and `<Hint>`:** `src/help/controls.ts` (types, `EXEMPT`), `<Hint>` component (Tooltip + `data-control` + "More in Help"), registry and coverage tests.
   - Check: tests for unique ids, non-empty text, help topics exist, every used id registered.
2. **Control finder:** header search field + Ctrl/⌘K dialog, search ranking, reveal bus (`useRevealPanel`), scroll + flash + focus.
   - Check: ranking and reveal-sequence tests; keyboard-only use (open, arrows, Enter, Esc).
3. **Plate Reader hints:** every control on Plate map, Results, Experiment; panel handlers for the three tabs.
4. **FTIR hints:** inspector (all four sections), chart toolbar, peak table, overlay, sessions rail; panel handlers for inspector sections.
5. **LCMS hints:** tools panel tabs, charts toolbars, dialogs' entry buttons, ribbon, polymer controls (largest task; may be split into two commits); panel handlers.
6. **AI + app shell hints:** AI tab controls, header, workspace menu, theme.
7. **Help drawer audit:** fix stale LCMS/FTIR/AI topics; "Show me" buttons on topics with control ids.
   - Check: coverage test fully green with no unexplained exemptions; live check: find 10 representative controls by search in day and night themes; user review; merge.

## Stage 2: getting started

8. **Example data API:** `GET /api/examples`, `POST /api/examples/{id}/open` (copies fixture, "Example – " name, tag `Example`, preset plate layouts). Check: API tests.
9. **Empty states + Try example** on every tab.
10. **Home page** with task cards, recent files, *Open on* setting.
11. **Tours:** tour engine (steps by control id, dim + highlight, offer card once) and one tour per tab.
    - Check: tests for tour step resolution and "offer once"; live check; user review; merge.

## Stage 3: guided workflows

12. **Workflow dialog framework:** steps, defaults, "I don't know", summary, remembered answers.
13. **MIC plate workflow.**
14. **LCMS find my product** (short design check with the user first).
15. **FTIR identify peaks.**
16. **Prepare for paper.**
    - Each: tests for the steps → settings mapping; live check; user review; merge.

## Stage 4: walkthroughs

17. Record GIFs per workflow and tour with example data; add to help topics; merge.
