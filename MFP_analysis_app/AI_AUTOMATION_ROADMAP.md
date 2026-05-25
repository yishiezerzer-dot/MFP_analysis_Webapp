# AI Automation Roadmap For The MFP Analysis Webapp

## Goal

Let an external coding agent (Cursor, Codex CLI, Claude Code) — and later an in-app AI assistant — drive the webapp's analyses through typed actions that run the same deterministic logic as the UI buttons. No DOM scraping, no UI clicking.

## Ordering

**External-agent control first. In-app AI second.**

Rationale:
- Cursor / Codex / Claude Code are already part of the user's daily workflow. Exposing the app's actions to them gives immediate value at zero LLM-provider integration cost.
- Designing tools for external agents forces clean, typed, stateless contracts. The in-app assistant later consumes the same contracts verbatim, so no work is wasted.
- The in-app assistant adds UI + provider plumbing that depends on the action contracts being stable. Building it first risks rewriting it when MCP requirements clarify the contract.

## Phase Overview (reviewable steps)

| # | Phase                                       | Outcome                                                                     |
|---|---------------------------------------------|-----------------------------------------------------------------------------|
| 1 | Extract pure analysis                       | Move computation out of `LCMSView.tsx` so it can be called from anywhere    |
| 2 | Backend action registry + endpoints         | Stateless typed actions invokable over HTTP                                 |
| 3 | Local MCP server                            | Codex/Cursor/Claude can list and call actions on the running backend        |
| 4 | Browser-state bridge                        | MCP-invoked actions can push results into the open UI (EICs, features, etc.)|
| 5 | Frontend action shim                        | Existing UI buttons go through the action registry — single source of truth |
| 6 | In-app AI assistant with tool calling       | Chat view uses OpenAI/Anthropic/Ollama with the same action catalog         |
| 7 | Assistant polish + action log viewer        | History, prompts, multi-step workflows                                      |

Each phase ends with a **review checkpoint** — concrete tests to run together before moving on.

---

## Phase 1 — Extract Pure Analysis

**Why:** Right now `LCMSView.tsx` (~7800 lines) owns both UI state and analytical logic. To call those analyses from MCP, an LLM, or a test, we need them isolated.

**Tasks:**

1. Create `MFP_analysis_app/web/frontend/src/lcms/analysis.ts` — pure functions, no React imports:
   - `integrateEICPeak(eic, referenceRt?)`
   - `buildKendrickPoints(spectrum, repeatMass, ...)`
   - `buildExpectedProductHits(settings, polarity, index, maxDp, ...)`
   - `buildSpectrumIndex(spectrum)`, `findMostIntenseSpectrumPeak(...)`
   - `groupFeatureRowsForMatrix(rows, sessions, ...)`
2. Re-export from `LCMSView.tsx` so the existing UI imports keep working with no behavior change.
3. Add Vitest unit tests under `src/lcms/__tests__/` for each pure function (fixture spectra, known peaks).
4. On the Python side, audit `lab_gui/lcms_polymer_match.py` and `lab_gui/lcms_io.py` — already pure; document any module that still imports Tk and split it.

**Acceptance criteria:**
- `npm run lint` passes.
- Every UI feature behaves identically (manual smoke test of EIC, integration, Kendrick, expected products, comparison matrix).
- Unit tests run green: `npm test` (we'll add `vitest` if it's not already installed).

**Review checkpoint with you:** I'll show the function-by-function diff and we walk through each extracted file before moving to phase 2.

---

## Phase 2 — Backend Action Registry & Endpoints

**Why:** A single source of truth for "what the app can do." Each action gets a typed input/output, a risk level, and a stable id that all later phases reference.

**Tasks:**

1. Create `MFP_analysis_app/web/backend/app/automation/`:
   ```
   automation/
     __init__.py
     registry.py          # Action registry + ActionSpec dataclass
     models.py            # Pydantic input/output models per action
     router.py            # FastAPI routes
     actions/
       __init__.py
       lcms_sessions.py   # list_sessions, select_session, get_state
       lcms_spectrum.py   # load_spectrum_at_rt, get_top_spectrum_peaks, find_mz
       lcms_eic.py        # create_eic, integrate_eic
       lcms_polymer.py    # compute_expected_products, match_polymers, ...
       lcms_kendrick.py   # compute_kendrick_plot, list_kendrick_series
       lcms_features.py   # get_feature_table, build_comparison_matrix
       lcms_export.py     # export_feature_table_csv, export_comparison_matrix_csv
   ```
2. `ActionSpec` shape (Python):
   ```python
   @dataclass(frozen=True)
   class ActionSpec:
       id: str                          # e.g. "lcms.create_eic"
       summary: str                     # one-line description
       input_model: type[BaseModel]
       output_model: type[BaseModel]
       risk: Literal["safe", "confirm", "destructive"]
       scope: Literal["backend", "browser", "both"]
       handler: Callable[..., Awaitable[BaseModel]]
   ```
3. Three FastAPI routes:
   - `GET /api/automation/actions` → list of `{id, summary, input_schema, output_schema, risk, scope}`
   - `POST /api/automation/actions/{id}/execute` → runs handler, returns output
   - `POST /api/automation/actions/{id}/preview` → for risky actions, runs a dry-pass and returns what would change (`affected_session_ids`, `estimated_duration_ms`, `warnings`)
4. Action log table (in-memory for V1): `GET /api/automation/logs` returns the last N entries with `{timestamp, action_id, args_summary, status, duration_ms, result_summary}`.
5. **Initial action set (backend-pure, no browser state needed):**
   - `lcms.list_sessions`, `lcms.get_session_state`
   - `lcms.find_mz`, `lcms.get_tic`, `lcms.get_spectrum_at_rt`, `lcms.get_top_spectrum_peaks`
   - `lcms.create_eic` (computes EIC, returns JSON — does NOT yet push to UI)
   - `lcms.integrate_eic_data` (takes EIC payload, returns integration result)
   - `lcms.sum_tic_region_spectrum`
   - `lcms.compute_expected_products`
   - `lcms.match_polymers_for_spectrum`
   - `lcms.compute_kendrick_plot`
   - `lcms.build_comparison_matrix` (takes feature rows from caller, returns matrix)

**Acceptance criteria:**
- `curl http://127.0.0.1:8000/api/automation/actions` returns the catalog.
- `curl -X POST .../api/automation/actions/lcms.find_mz/execute -d '{"session_id": "...", "mz": 150.1}'` returns matched peaks.
- Pydantic input validation rejects malformed bodies with HTTP 422.
- Action log records every call.

**Review checkpoint:** I'll exercise 4-5 endpoints with curl + JSON snippets and we agree the contracts look right before phase 3.

---

## Phase 3 — Local MCP Server

**Why:** This is the headline feature — Codex / Cursor / Claude Code can now directly drive the analyses.

**Tasks:**

1. Create `MFP_analysis_app/mcp_server/` (sibling to `web/`):
   ```
   mcp_server/
     pyproject.toml             # depends on mcp[cli] >= 1.0
     mfp_mcp/
       __init__.py
       __main__.py              # python -m mfp_mcp
       server.py                # MCP Server instance, stdio transport
       backend_client.py        # httpx wrapper around /api/automation/*
       config.py                # backend URL, auth, timeouts
   ```
2. `server.py` uses the official Python MCP SDK:
   - On startup, calls `GET /api/automation/actions`, registers each as an MCP Tool with its JSON schema.
   - Each tool handler forwards arguments to `POST .../execute`.
   - For `risk == "confirm"` and `scope == "browser"` actions, return a structured `requires_confirmation` or `requires_open_app` response instead of executing — the calling agent surfaces it to the user.
3. Provide example configs:
   - `mcp_server/examples/cursor.mcp.json`
   - `mcp_server/examples/claude_code.mcp.json`
   - `mcp_server/examples/codex.mcp.json`
4. Document: in the README, exact paste-able JSON for each agent.
5. **No filesystem, shell, or network tools.** The MCP server only exposes the action catalog.

**Acceptance criteria:**
- Add the MCP server to Claude Code via `claude mcp add`. Running `/mcp` lists the MFP tools.
- From Claude Code: "list LCMS sessions" → tool call succeeds, returns session list.
- From Claude Code: "find m/z 232.14 in the active session" → returns matched peaks across scans.
- From Claude Code: "compute the Kendrick plot for session X with repeat mass 14.0157" → returns series + points JSON.
- A risky action attempted from the agent returns `requires_confirmation`.

**Review checkpoint:** Live demo together — Claude Code in another terminal drives a real session. Once that works, MCP is "done" for the stateless layer.

---

## Phase 4 — Browser-State Bridge

**Why:** A lot of useful actions are inherently browser-side (push a new EIC plot into the open view, add a row to the feature table, set polymer UI settings, focus the Kendrick dialog). Without this bridge, MCP can only return JSON — useful but limited.

**Tasks:**

1. Add a WebSocket endpoint `ws://localhost:8000/api/automation/browser-bridge` that the frontend connects to on mount with a `browser_id`.
2. Backend maintains a registry `Dict[browser_id, WebSocket]`. The most recent open tab wins (single-user app).
3. New action scope: `"browser"`. When the backend handler runs, instead of executing locally it:
   - Resolves the active browser connection.
   - Sends `{action_id, args, request_id}` over the WS.
   - Waits for a `{request_id, result | error}` response with a 30 s timeout.
   - If no browser is connected, returns HTTP 409 with `{error: "requires_open_app"}`.
4. Frontend `BrowserBridge` provider (new file `src/automation/BrowserBridge.tsx`):
   - Opens the WS, handles reconnect with backoff.
   - Holds a `dispatch(action_id, args) → result` table of registered handlers.
   - Initial registered handlers (mirror existing UI behavior):
     - `lcms.push_eic_to_ui` — given the EIC payload from `create_eic`, add it as a `LCMSEICPlot`.
     - `lcms.set_polymer_settings` — patch `polymerSettings` state.
     - `lcms.add_feature_row` — append to `featureRows`.
     - `lcms.open_dialog` — open Kendrick / Expected Products / Comparison / Feature Table.
     - `lcms.scroll_to_eic`, `lcms.highlight_feature_row`.
     - `lcms.load_spectrum_at_rt`, `lcms.next_scan`, `lcms.previous_scan`.
     - `lcms.clear_eics`, `lcms.clear_features` (risk=confirm).
5. Combo actions: `lcms.create_eic_and_show` = backend `create_eic` → browser `push_eic_to_ui`. Codex calls this when the user wants the EIC visible in the UI.

**Acceptance criteria:**
- With the app open: Codex says "make an EIC for m/z 232.14 and put it in the UI" → new EIC plot appears.
- With the app closed: same request returns `requires_open_app`.
- Disconnect/reconnect of the browser tab is handled (no leaked WSes).

**Review checkpoint:** Live test together — Codex pushes EICs, feature rows, and dialog opens into the running UI.

---

## Phase 5 — Frontend Action Shim

**Why:** Eliminate duplication. Every UI button should call the same action handler that MCP uses, so behavior can't drift.

**Tasks:**

1. Build a frontend action registry mirroring the backend one: `src/automation/registry.ts`.
2. For each existing UI button in `LCMSView.tsx`, replace its inline `onClick` body with `actionRegistry.dispatch("lcms.X", args)`.
3. The dispatch function:
   - For backend-scope actions: `POST /api/automation/actions/X/execute`.
   - For browser-scope actions: call the registered local handler directly (no WS round-trip when called from the same browser).
4. Add `zod` for input validation on the frontend side (matches backend Pydantic schemas).

**Acceptance criteria:**
- Every existing button works identically.
- New buttons added later only need to register an action — no inline handlers.

**Review checkpoint:** Walk through 5–6 representative buttons (EIC, Integrate, Open Feature Table, Compute Expected Products, Open Kendrick) and confirm UX is unchanged.

---

## Phase 6 — In-App AI Assistant With Tool Calling

**Why:** Now that the action catalog is solid and proven over MCP, wiring it to an in-app LLM is straightforward.

**Tasks:**

1. Upgrade the existing AI Assistant view to support tool-calling chat with three providers (provider-neutral interface):
   - OpenAI (function calling / Structured Outputs)
   - Anthropic (tools API)
   - Ollama (local, optional)
2. The assistant's tool list comes from `GET /api/automation/actions` — same source as MCP. No duplication.
3. Approval flow:
   - `risk == "safe"`: auto-executes, result rendered in chat.
   - `risk == "confirm"`: shows "Approve" / "Reject" buttons inline before executing.
   - `risk == "destructive"`: requires Approve and shows the preview payload.
4. Render result types specially:
   - EICs → mini Plotly preview + "Open in UI" button (calls `push_eic_to_ui`).
   - Feature rows → mini table preview + "Add to Feature Table" button.
   - Kendrick plots → image + "Open Kendrick Dialog" button.
   - CSV exports → download link.
5. Settings:
   - API key per provider (existing pattern — env or settings dialog).
   - "Auto-execute safe actions" toggle (default: on).
   - "Show tool-call trace" toggle (default: off; on shows JSON for debugging).

**Acceptance criteria:**
- "Create an EIC for m/z 150.1" → tool call → EIC appears in UI.
- "Integrate all visible EICs and show me the feature table" → multi-step tool calls execute in sequence.
- "Clear all EICs" → confirmation dialog appears.

**Review checkpoint:** End-to-end demo with a real LLM provider; iterate on prompt UX before phase 7.

---

## Phase 7 — Polish

**Tasks:**

- **Action log viewer**: dialog accessible from the AI Assistant footer; filterable by action id, status, time.
- **Saved prompt templates**: "Find expected products in current spectrum", "Compare feature areas across loaded samples", etc.
- **Multi-step workflow recording**: capture a sequence of actions as a named macro for later replay.
- **Action-result attachments**: when an action produces a plot or table, attach it to the chat message so the user can re-view it.
- **Provider routing**: optional fallback chain (OpenAI → Anthropic → Ollama).

These are quality-of-life and can be sequenced independently after phase 6 ships.

---

## LCMS Action Catalog (consolidated reference)

Marked `S` = safe (auto-execute), `C` = confirm, `D` = destructive. `B` = backend-only, `U` = browser-bridge required, `*` = combo (backend compute + browser push).

Catalog is grouped by the **section of the UI** the action corresponds to. The action `id` becomes the MCP tool name and the in-app assistant tool name verbatim.

### Sessions — upload, list, switch, delete
- `lcms.upload_session` — S B (multipart upload of an mzML file)
- `lcms.load_session_from_path` — S B (absolute path on the server's filesystem; needed for workspace restore)
- `lcms.list_sessions` — S B
- `lcms.get_session_state` — S B (active session + polarity + selected RT + summary)
- `lcms.select_session` — S U
- `lcms.delete_session` — D B
- `lcms.set_rt_unit` — S U (`minutes` | `seconds`)
- `lcms.set_polarity` — S U (`positive` | `negative` | `all`)

### Projects (sidebar grouping of sessions)
- `lcms.list_projects` — S U
- `lcms.create_project` — S U
- `lcms.delete_project` — C U
- `lcms.rename_project` — S U
- `lcms.move_session_to_project` — S U (or to `__unassigned`)
- `lcms.select_project` — S U (`__all`, `__unassigned`, or project id)

### Workspace
- `lcms.save_workspace` — S U (downloads JSON)
- `lcms.load_workspace` — D U (overwrites current state, requires confirmation)
- `lcms.list_workspaces` — S U (entries persisted in localStorage)

### TIC
- `lcms.get_tic` — S B
- `lcms.create_tic_overlay` — S B (pass `session_ids[]`, returns overlay data)
- `lcms.set_overlay_sessions` — S U (controls which sessions overlay)
- `lcms.set_region_select` — S U (toggle region-drag mode on TIC)
- `lcms.set_tic_region` — S U (programmatically set rtMin/rtMax)
- `lcms.sum_tic_region_spectrum` — S B (computes summed MS1 over a region)
- `lcms.show_summed_region_spectrum` — S * (compute + push to MS1 chart)

### Navigation
- `lcms.load_spectrum_at_rt` — S U
- `lcms.next_scan` — S U
- `lcms.previous_scan` — S U
- `lcms.first_scan` — S U
- `lcms.last_scan` — S U
- `lcms.jump_to_rt` — S U

### Spectrum / m/z
- `lcms.get_spectrum_at_rt` — S B
- `lcms.get_top_spectrum_peaks` — S B
- `lcms.find_mz` — S B (scan-wide presence of a target m/z)
- `lcms.set_spectrum_display_settings` — S U (top_n, min_rel)
- `lcms.toggle_overlay_spectrum` — S U (overlay MS1 from multiple sessions at the same RT)
- `lcms.set_overlay_spectrum_sessions` — S U

### EIC
- `lcms.set_eic_tolerance_default` — S U
- `lcms.create_eic` — S B (returns EIC data, does not push to UI)
- `lcms.create_eic_and_show` — S * (push to open UI)
- `lcms.create_eics_for_masses` — C * (bulk)
- `lcms.set_eic_overlay_settings` — S U (normalize, stack, opacity, legend)
- `lcms.toggle_eic_overlay_mode` — S U (separate plots vs single overlay)
- `lcms.integrate_eic_data` — S B (pure compute, returns integration result)
- `lcms.integrate_visible_eics` — C U (mutates feature table)
- `lcms.clear_eics` — C U
- `lcms.remove_eic` — S U (single EIC by id)

### Polymer / matching
- `lcms.get_polymer_settings` — S U
- `lcms.set_polymer_settings` — S U
- `lcms.apply_small_oligomer_preset` — S U
- `lcms.save_polymer_defaults` — S U (persist current settings as default)
- `lcms.list_polymer_monomer_presets` — S U
- `lcms.save_polymer_monomer_preset` — S U
- `lcms.delete_polymer_monomer_preset` — C U
- `lcms.match_polymers_for_spectrum` — S B (annotate current spectrum)
- `lcms.match_polymers_for_region` — S B (annotate region-summed spectrum)

### Expected products
- `lcms.compute_expected_products` — S B (single scan)
- `lcms.compute_expected_products_all_scans` — S B (scan-wide, returns matches per scan)
- `lcms.create_eics_for_expected_products` — C *
- `lcms.export_expected_products_csv` — S B (single scan)
- `lcms.export_expected_products_all_scans_csv` — S B

### Kendrick
- `lcms.compute_kendrick_plot` — S B
- `lcms.list_kendrick_series` — S B
- `lcms.create_eics_for_kendrick_series` — C *

### Feature table
- `lcms.get_feature_table` — S U (reads from React state)
- `lcms.add_feature_row` — S U
- `lcms.update_feature_row` — S U (label, annotation)
- `lcms.remove_feature_row` — C U
- `lcms.clear_features` — C U
- `lcms.locate_feature_eic` — S U (scrolls to the EIC plot, highlights it)
- `lcms.export_feature_table_csv` — S B

### Comparison matrix
- `lcms.build_comparison_matrix` — S B (takes rows + options, returns matrix)
- `lcms.export_comparison_matrix_csv` — S B

### UV chromatogram
- `lcms.attach_uv_file` — S B (multipart upload)
- `lcms.attach_uv_from_path` — S B
- `lcms.get_uv` — S B
- `lcms.clear_uv` — C B (DELETE on backend; per session)
- `lcms.set_uv_offset` — S U (X-axis offset for UV-vs-MS alignment)
- `lcms.auto_align_uv` — S U (cross-correlate UV to TIC)
- `lcms.detect_uv_peaks` — S B (returns peak list; no UI mutation)
- `lcms.auto_label_uv_peaks` — S U (compute peaks + push labels to chart)
- `lcms.add_uv_label` — S U
- `lcms.add_custom_uv_label` — S U (free-text)
- `lcms.remove_uv_label` — S U
- `lcms.clear_uv_labels` — C U
- `lcms.label_current_rt_on_uv` — S U
- `lcms.transfer_selected_ms_labels_to_uv` — C U
- `lcms.set_uv_bunch_settings` — S U (bunch / snap / hub offsets)
- `lcms.auto_arrange_uv_labels` — S U
- `lcms.set_uv_label_orientation` — S U (`vertical` | `horizontal`)
- `lcms.set_uv_label_stair_steps` — S U (X/Y stair offsets)

### Graph / chart settings
- `lcms.get_graph_settings` — S U
- `lcms.set_graph_settings` — S U (TIC / spectrum / EIC chart appearance)
- `lcms.save_graph_settings_default` — S U
- `lcms.reset_graph_settings` — C U

### Exports
- `lcms.export_spectrum_csv` — S B
- `lcms.export_labels_csv` — S B (all-scan label dump)
- `lcms.export_uv_csv` — S B
- `lcms.export_tic_overlay_csv` — S B
- `lcms.export_feature_table_csv` — S B (also listed above)
- `lcms.export_comparison_matrix_csv` — S B (also listed above)
- `lcms.export_expected_products_csv` — S B (also listed above)
- `lcms.export_expected_products_all_scans_csv` — S B (also listed above)

---

## Approval Model

- **Safe**: auto-executes without prompting; logged.
- **Confirm**: agent receives `requires_confirmation` response with a preview payload (`affected_session_ids`, `estimated_duration_ms`, `summary_of_changes`). The agent must re-submit with `confirmation_token`.
- **Destructive**: same as confirm, but the in-app assistant displays the preview in a more prominent banner and the MCP response includes an explicit `"destructive": true` flag.

Every executed action logs: `{timestamp, action_id, args_hash, args_summary, actor (mcp|chat|ui), status, duration_ms, result_summary, affected_session_ids}`.

---

## What Not To Build

- **Playwright / DOM-clicking automation** — bypasses the action layer, fragile, untrusted.
- **Unrestricted MCP filesystem / shell tools** — out of scope, security risk.
- **A separate chatbot that doesn't use the action registry** — guaranteed drift.
- **Auto-executing destructive actions** — always confirm.
- **Frontend writing directly to backend SQL / session registries** — must go through actions.

---

## Test Plan

### Phase 1 — pure analysis
- Vitest unit tests for each extracted pure function with reference fixtures.
- Manual: full UI smoke test, no behavior changes.

### Phase 2 — backend action registry
- pytest for each action: input validation, expected output shape, error paths.
- `curl` smoke test for `GET /actions` and `POST /actions/{id}/execute`.

### Phase 3 — MCP server
- Run `mcp dev` (or equivalent) and verify the tool list matches the action registry.
- End-to-end: list sessions, find m/z, compute Kendrick from Claude Code in a separate terminal.

### Phase 4 — browser bridge
- WS connect / disconnect / reconnect tests.
- "App closed" error path returns `requires_open_app`.
- With app open: EIC push, feature row add, dialog open all work.

### Phase 5 — frontend shim
- Visual regression: every existing UI button still produces the same outcome.

### Phase 6 — in-app assistant
- Provider integration tests against each provider (mock + live).
- Confirmation flow tests.
- Multi-step workflow tests ("find expected products and integrate top 5 EICs").

### Phase 7 — polish
- Action log viewer rendering with various filters.
- Macro record/replay round-trip.

---

## Package Recommendations

| Phase | Package                                                 | Why                                                |
|-------|---------------------------------------------------------|----------------------------------------------------|
| 1     | `vitest` (frontend), existing `pytest` (backend)        | Unit-test pure analysis                            |
| 2     | Existing `fastapi`, `pydantic`                          | Already used                                       |
| 3     | `mcp[cli]` (Python MCP SDK), `httpx`                    | Official MCP server lib                            |
| 4     | `fastapi` WebSocket support (built in), `zustand`?      | Optional state library if BrowserBridge needs it   |
| 5     | `zod`                                                   | Frontend schema validation matching backend        |
| 6     | `openai`, `@anthropic-ai/sdk`, existing Ollama support  | Provider SDKs                                      |
| 7     | None new                                                | UI polish only                                     |

**Avoid:** CopilotKit, AG-UI, Playwright, agent frameworks that hide the tool layer — they all add abstraction we don't need and obscure the action contract.

---

## Review Process (mirroring the LCMS roadmap)

For every phase:

1. Codex implements the phase against the spec above.
2. I review the diff and call out concerns (correctness, edge cases, UX, security).
3. We discuss, prioritize fixes.
4. Codex (or I) apply fixes.
5. Type-check + tests pass.
6. Live demo of the acceptance criteria together.
7. Mark phase ✅ and move to the next.

## Decisions Locked In (binding constraints for implementation)

These are settled. Codex should implement against them; reopen only with a written justification.

| # | Topic | Decision | Notes |
|---|---|---|---|
| 1 | Frontend test runner | **Vitest** | Already installed; phase 1 tests use it |
| 2 | Action log persistence (V1) | **In-memory ring buffer, 500 entries** | Port to SQLite in phase 7 alongside the log viewer UI |
| 3 | Browser-bridge multi-tab policy | **Most-recent-connection wins** | Older tabs get a `bridge_superseded` message and silently drop; no fan-out, no tab picker |
| 4 | MCP transport | **stdio** | Universally supported by Cursor / Codex / Claude Code; no port/auth burden in V1 |
| 5 | Confirmation tokens | **In-memory nonce, 5-min TTL** | Issued by `/preview`, returned in response, required by `/execute` for `risk in {confirm, destructive}`. Backend stores `dict[token, (action_id, args_hash, expires_at)]` |
| 6 | Handler concurrency | **All handlers `async def`; CPU-bound work via `asyncio.to_thread(...)`** | Document this as a one-line rule in `registry.py` |
| 7 | Auth on `/api/automation/*` | **None in V1** | Backend bound to `127.0.0.1`; revisit if remote MCP is ever needed |
| 8 | Action ID format | **`<tab>.<verb>_<noun>`** | e.g. `lcms.create_eic`, `ftir.match_references` |
| 9 | Session lookup in actions | **Actions take `session_id`, look up internally** | Keeps the action contract stateless from the caller's POV |

---

## Implementation Status (Codex Checklist)

Codex: tick each box as you complete it. A phase isn't "done" until the **Review checkpoint** at the end is signed off by Yishi.

### Phase 1 — Extract pure analysis

**Setup**
- [x] Install Vitest (`npm i -D vitest @vitest/ui`)
- [x] Add `"test": "vitest"` and `"test:run": "vitest run"` to `package.json` scripts
- [x] Create `src/lcms/` directory
- [x] Create `src/lcms/__tests__/` directory with `fixtures/` subfolder

**Extract pure functions to `src/lcms/analysis.ts`**
- [x] Move `integrateEICPeak` (+ `LCMSEICData` types if not already shared)
- [x] Move `buildKendrickPoints`, `KendrickPoint`, `KendrickSeries`
- [x] Move `buildExpectedProductHits` + `parseExpectedProductMonomers`, `EXPECTED_PRODUCT_MAX_DP`, `ExpectedProductResolutionMode`
- [x] Move `buildSpectrumIndex`, `findMostIntenseSpectrumPeak`, `lowerBound`
- [x] Extract comparison-matrix grouping out of `ComparisonMatrixDialog` into `groupFeatureRowsForMatrix(rows, sessions, options)`
- [x] Move `ionLabel`, `toSuperscript`, `SUPERSCRIPT_DIGITS`
- [x] Move CSV builder helpers (header + row escape)
- [x] Move polymer-settings conversion (`toApiPolymerSettings`)
- [ ] Move graph-settings conversion (`mergeGraphSettings`) only if phase 4/5 browser actions need it

**Wire up imports**
- [x] Update `LCMSView.tsx` to import from `src/lcms/analysis.ts` (no behavior change)
- [x] Remove the original definitions from `LCMSView.tsx`

**Tests**
- [x] Fixture: minimal EIC payload (10 points, one clear peak)
- [x] Fixture: minimal SpectrumData payload
- [x] Fixture: feature rows for matrix grouping
- [x] Test `integrateEICPeak` — apex, baseline-from-outside, slope-stop, multi-peak with reference RT
- [x] Test `buildKendrickPoints` — running-mean clustering, ppm vs kmd tolerance
- [x] Test `buildExpectedProductHits` — basic composition, 2M cluster monomer-presence gate
- [x] Test `buildFeatureMatrix` — evidence grouping, m/z fallback, anchor (NOT running-mean) m/z clustering

**Verification**
- [x] `npm run lint` passes
- [x] `npm run test:run` passes
- [x] Python audit: `lab_gui/lcms_polymer_match.py` and `lab_gui/lcms_io.py` remain UI-free/no Tk dependency
- [x] Production build smoke: `npm run build` passes
- [ ] Manual smoke test: EIC, Integrate, Kendrick, Expected Products, Comparison Matrix all behave identically
- [ ] **Review checkpoint with Yishi** — function-by-function diff walkthrough

---

### Phase 2 — Backend action registry & endpoints

**Setup**
- [x] Create `app/automation/` package structure (`__init__.py`, `registry.py`, `models.py`, `router.py`, `actions/`)
- [x] Define `ActionSpec` dataclass in `registry.py`
- [x] Define base `ActionResult`, `ActionError`, `ActionPreview` Pydantic models in `models.py`
- [x] Implement `register(spec)` decorator
- [x] Implement `get_action(id)`, `list_actions()`, `execute(id, args)`, `preview(id, args)`
- [x] Implement in-memory action log (ring buffer, 500 entries)

**Router endpoints**
- [x] `GET /api/automation/actions` — catalog
- [x] `POST /api/automation/actions/{id}/execute`
- [x] `POST /api/automation/actions/{id}/preview`
- [x] `GET /api/automation/logs`
- [x] Wire router into `app/main.py`

**Implement initial backend-only actions** (each in its own module under `actions/`)
- [x] `lcms.list_sessions`
- [x] `lcms.get_session_state`
- [x] `lcms.get_tic`
- [x] `lcms.get_spectrum_at_rt`
- [x] `lcms.get_top_spectrum_peaks`
- [x] `lcms.find_mz`
- [x] `lcms.create_eic` (returns EIC data only)
- [x] `lcms.integrate_eic_data` (pure compute over a passed-in EIC)
- [x] `lcms.sum_tic_region_spectrum`
- [x] `lcms.compute_expected_products`
- [x] `lcms.match_polymers_for_spectrum`
- [x] `lcms.compute_kendrick_plot`
- [x] `lcms.build_comparison_matrix`
- [x] `lcms.export_feature_table_csv`
- [x] `lcms.export_comparison_matrix_csv`

**Tests**
- [ ] pytest fixture: a small mzML file
- [x] Test: each action accepts valid input and returns expected shape
- [x] Test: malformed input returns HTTP 422
- [x] Test: unknown action id returns HTTP 404
- [x] Test: action log records each call
- [x] Test: missing LCMS session returns HTTP 404 via `SessionNotFound`

**Verification**
- [x] `curl http://127.0.0.1:8000/api/automation/actions` returns the catalog
- [x] Slice smoke: `curl -X POST .../lcms.list_sessions/execute -d '{}'` returns sessions
- [x] Slice smoke: `curl -X POST .../lcms.get_tic/execute -d '{"session_id":"..."}'` returns TIC
- [x] `curl -X POST .../lcms.find_mz/execute -d '{"session_id":"...","mz":150.1}'` returns peaks
- [x] `curl http://127.0.0.1:8000/api/automation/logs` shows the calls just made
- [ ] **Review checkpoint with Yishi** — 4–5 curl examples + JSON contracts

---

### Phase 3 — Local MCP server

**Setup**
- [x] Create `MFP_analysis_app/mcp_server/` (sibling to `web/`)
- [x] Create `pyproject.toml` with `mcp[cli]>=1.0`, `httpx`, `pydantic`
- [x] Run `uv pip install -e .` (or `pip install -e .`)
- [x] Create `mfp_mcp/__init__.py`, `__main__.py`, `server.py`, `backend_client.py`, `config.py`

**Implementation**
- [x] `config.py`: backend URL, request timeout (default 60s), env var overrides
- [x] `backend_client.py`: thin httpx wrapper around `/api/automation/*`
- [x] `server.py`: instantiate MCP `Server`, stdio transport
- [x] On startup: fetch action catalog, register each as MCP Tool with its JSON schema
- [x] Tool handler: forward args to `execute` endpoint
- [x] Surface `requires_confirmation` as a structured error tool result (not an exception)
- [x] Surface `requires_open_app` similarly
- [x] Pretty-print result JSON so agents render it readably

**Config examples**
- [x] `mcp_server/examples/cursor.mcp.json`
- [x] `mcp_server/examples/claude_code.mcp.json`
- [x] `mcp_server/examples/codex.mcp.json`
- [x] `mcp_server/README.md` with paste-able snippets and `claude mcp add` invocation

**Verification**
- [x] `pip install -e .` succeeds; `python -m mfp_mcp` boots over stdio
- [x] MCP handshake + `list_tools` returns 15 tools matching the backend catalog
- [x] "list LCMS sessions" -> tool call succeeds (empty session list confirms plumbing)
- [x] HTTP 404 (`get_tic` missing session) -> structured error with status_code=404 + isError=true
- [x] HTTP 422 (`find_mz` bad input) -> structured error with isError=true
- [x] Stateless tool (`integrate_eic_data` without `session_id`) executes and returns peak metrics
- [x] Unknown tool name -> structured `unknown_action` response (no crash)
- [ ] `confirm`/`destructive` action returns `requires_confirmation` — deferred; no such actions exist in the phase 2 catalog. Will be exercised in phase 4 when `lcms.clear_eics` etc. arrive.
- [ ] `browser`-scope action returns `requires_open_app` — deferred for the same reason.
- [x] **Review checkpoint with Yishi** — live demo via stdio client; behavior confirmed

---

### Phase 4 — Browser-state bridge

**Backend**
- [x] Add WebSocket route `ws://.../api/automation/browser-bridge`
- [x] Implement `BrowserConnectionRegistry` (single-tab wins)
- [x] When a `scope="browser"` action is invoked: serialize args, send over WS, await `{request_id, result|error}` with 30 s timeout
- [x] Return HTTP 409 `{error: "requires_open_app"}` if no connection
- [x] Heartbeat / ping every 20 s; close stale connections

**Frontend — `src/automation/BrowserBridge.tsx`**
- [x] WebSocket connection with exponential backoff reconnect
- [x] Handler registry: `register(actionId, handler)` / `unregister(actionId)`
- [x] Dispatch incoming messages to the registered handler, post `{request_id, result}` back
- [x] Provider mounted in `App.tsx`

**Register browser-scope handlers** (use existing LCMSView state setters)
- [x] `lcms.push_eic_to_ui`
- [x] `lcms.set_polymer_settings`
- [x] `lcms.add_feature_row`
- [x] `lcms.update_feature_row`
- [x] `lcms.remove_feature_row`
- [x] `lcms.clear_features` (confirm)
- [x] `lcms.clear_eics` (confirm)
- [x] `lcms.open_dialog` (`kendrick` | `expected_products` | `comparison_matrix` | `feature_table` | `polymer` | `find_mz` | `eic` | `graph_settings`)
- [x] `lcms.scroll_to_eic`
- [x] `lcms.highlight_feature_row`
- [x] `lcms.load_spectrum_at_rt`
- [x] `lcms.next_scan` / `lcms.previous_scan` / `lcms.first_scan` / `lcms.last_scan`
- [x] `lcms.jump_to_rt`
- [x] `lcms.select_session`
- [x] `lcms.set_polarity`
- [x] `lcms.set_rt_unit`
- [x] `lcms.set_overlay_sessions` / `lcms.toggle_overlay_spectrum`
- [x] `lcms.set_eic_overlay_settings` / `lcms.toggle_eic_overlay_mode`

**Combo (`*` scope) actions** — backend compute + browser push
- [x] `lcms.create_eic_and_show`
- [x] `lcms.show_summed_region_spectrum`
- [x] `lcms.create_eics_for_masses` (bulk)
- [x] `lcms.create_eics_for_expected_products`
- [x] `lcms.create_eics_for_kendrick_series`
- [x] `lcms.integrate_visible_eics`

**Verification**
- [x] App open + browser-scope action round-trips through the WS bridge (verified live + via pytest TestClient)
- [x] App closed + same request → HTTP 409 `requires_open_app` (verified live + pytest)
- [x] Tab close / connection drop → registry's `_finish_connection` cancels heartbeat and clears pending futures (`test_disconnect_cancels_heartbeat_and_clears_pending`)
- [x] Second tab supersedes first → old WS closed, old pending futures resolved with `BrowserConnectionRequired` (`test_registry_single_tab_wins_supersedes_old_connection`)
- [x] Backend restart while app is open → frontend reconnects via the exponential-backoff loop in `BrowserBridgeProvider.connect`
- [x] **Review checkpoint with Yishi** — phase-4 cleanup + 7 new bridge tests + 1 updated MCP test all green; live smoke confirms HTTP→WS→browser round-trip

---

### Phase 5 — Frontend action shim

**Setup**
- [x] Install `zod`
- [x] Create `src/automation/registry.ts`
- [x] Mirror backend action schemas as zod schemas (one file per action group)
- [x] Implement `dispatch(actionId, args)`:
  - browser-scope → call local handler directly
  - backend-scope → POST `/api/automation/actions/{id}/execute`
  - combo → POST execute, then browser dispatch with result

**Refactor existing UI buttons** (one-by-one; verify visually after each)
- [x] EIC dialog "Run" button → `dispatch("lcms.create_eic_and_show", ...)`
- [x] Find m/z dialog → `dispatch("lcms.find_mz", ...)`
- [x] Feature Table button → `dispatch("lcms.open_dialog", {dialog: "feature_table"})`
- [x] Integrate EIC button → `dispatch("lcms.integrate_visible_eics", ...)`
- [x] Clear EICs button → `dispatch("lcms.clear_eics")`
- [x] Comparison Matrix button → `dispatch("lcms.build_comparison_matrix", ...)`
- [x] Polymer Match button → `dispatch("lcms.match_polymers_for_spectrum", ...)`
- [x] Expected Products button → `dispatch("lcms.compute_expected_products", ...)`
- [x] Kendrick button → `dispatch("lcms.compute_kendrick_plot", ...)`
- [x] Sum Region Spectrum → `dispatch("lcms.show_summed_region_spectrum", ...)`
- [x] All Export buttons → `dispatch("lcms.export_*_csv", ...)`
- [x] UV: attach / clear / auto-align / auto-label / custom label / clear labels → respective actions
- [x] Navigation buttons (Prev / Next / First / Last / RT jump) → respective actions
- [x] Project sidebar (create / delete / move) → respective actions

**Verification**
- [x] Every existing UI button still works identically (27 migrated buttons; type-check + 98 vitest)
- [x] No inline `onClick` bodies remain for the migrated buttons (only `dispatch` calls)
- [x] Schema-call alignment locked down by a 53-action zod parse test (would catch drift like the original `export_comparison_matrix_csv` mismatch immediately)
- [x] **Review checkpoint with Yishi** — phase-5 cleanup applied; all tests green

---

### Phase 6 — In-app AI assistant with tool calling

**Provider plumbing**
- [x] Create `src/ai/providers/` with `openai.ts`, `anthropic.ts`, `ollama.ts`
- [x] Provider-neutral interface: `chat(messages, tools) → {message, tool_calls}`
- [x] OpenAI: function calling
- [x] Anthropic: tools API
- [x] Ollama: tool calling (where supported by model)
- [x] Settings UI: provider selector, model selector, API key field, "test" button

**Tool integration**
- [x] On chat init: fetch `/api/automation/actions`, convert to provider tool format
- [x] Tool call → dispatch through frontend action registry
- [x] Result rendered inline in chat
- [x] `risk == "safe"`: auto-executes (controlled by "Auto-execute safe actions" toggle, default on)
- [x] `risk == "confirm"`: shows Approve/Reject inline; after Approve, re-call with confirmation token
- [x] `risk == "destructive"`: same as confirm but preview payload shown prominently

**Result rendering**
- [x] EIC result → mini Plotly preview + "Open in UI" button
- [x] Feature row result → mini table + "Add to Feature Table" button
- [x] Kendrick result → image preview + "Open Kendrick Dialog" button
- [x] CSV result → download link
- [x] Plain JSON result → expandable code block

**Settings**
- [x] "Show tool-call trace" toggle (default off)
- [x] "Auto-execute safe actions" toggle
- [x] Per-provider API key storage (existing pattern)

**Verification**
- [ ] "Create an EIC for m/z 150.1" → EIC appears in UI
- [ ] "Integrate all visible EICs and show me the feature table" → multi-step execution
- [ ] "Clear all EICs" → confirmation prompt shown
- [ ] All three providers tested end-to-end (mock + at least one live)
- [ ] **Review checkpoint with Yishi** — end-to-end demo with one live provider

---

### Phase 7 — Polish

- [x] Action log viewer dialog (filter by id / status / time / actor)
- [x] Saved prompt templates UI ("Find expected products", "Compare integrated areas", etc.)
- [x] Macro recording (start/stop/save/replay)
- [ ] Plot/table attachments on chat messages (re-viewable) — deferred; inline ToolResultCard renders results but no re-view mechanism exists yet
- [x] Provider fallback chain (OpenAI → Anthropic → Ollama)
- [x] Persistent action log → SQLite (decide in pre-phase-1 questions)
- [ ] **Review checkpoint with Yishi**

---

### Phase Status (high-level)

- [x] Phase 1 — Extract pure analysis ✅ (smoke test passed; 26/26 unit tests green)
- [x] Phase 2 — Backend action registry & endpoints ✅ (15 actions; 57 pytest + 34 vitest green; cross-language fixtures lock TS↔Python parity)
- [x] Phase 3 — Local MCP server ✅ (handshake, list_tools, execute, error paths verified live over stdio)
- [x] Phase 4 — Browser-state bridge ✅ (25 browser/combo actions; 7 bridge tests; live HTTP→WS round-trip + no-browser 409 both verified)
- [x] Phase 5 — Frontend action shim — (53 actions schema-mapped; 27 UI buttons routed; 64 zod/registry tests; export_comparison_matrix_csv regression fixed)
- [x] Phase 5 — Frontend action shim
- [x] Phase 6 — In-app AI assistant with tool calling
- [x] Phase 7 — Polish — implementation complete; review checkpoint pending

---

# Other-Tab Action Catalogs (TEMPLATE)

Same architecture as LCMS — each tab gets its own typed action namespace under `app/automation/actions/<tab>_*.py`, the registry merges them, MCP exposes them all, and the in-app assistant lists them as separate tool groups.

For each tab below: skim the existing router + view, then fill in the action ids using the same grouping convention (`<tab>.<action>`), risk tags (`S` / `C` / `D`), and scope tags (`B` / `U` / `*`). Keep the action ids short, verb-first, and stable — they become tool names in MCP and the in-app assistant.

When you're ready to add a tab to the automation layer, run through the same review process: extract pure analysis (phase 1) → backend registry entry (phase 2) → MCP exposure happens automatically (phase 3 already iterates the registry) → browser bridge handlers as needed (phase 4) → UI shim (phase 5) → in-app assistant gets it for free (phase 6).

## FTIR

**Existing backend** (`app/routers/ftir.py`): sessions CRUD, spectrum preprocessing, peak detection, band integration, baseline subtract, reference-library match, region fit, peak-label overrides, library metadata.

**Suggested action groups (fill in as you implement):**

### Sessions / files
- `ftir.upload_session` — S B
- `ftir.list_sessions` — S B
- `ftir.get_session` — S B
- `ftir.delete_session` — D B

### Spectrum
- `ftir.get_spectrum` — S B (with preprocessing params: smoothing, baseline mode, normalization)
- `ftir.set_preprocessing` — S U
- `ftir.subtract_spectrum` — C * (compute + show)

### Peaks & bands
- `ftir.detect_peaks` — S B
- `ftir.set_peak_label_override` — S U
- `ftir.integrate_band` — S B
- `ftir.fit_region` — S B (curve-fit a region)

### Reference library
- `ftir.get_library_meta` — S B
- `ftir.list_library_categories` — S B
- `ftir.match_references` — S B (top-K library matches)

### Workspace / UI
- `ftir.save_workspace` — S U
- `ftir.load_workspace` — D U
- `ftir.set_graph_settings` — S U

### Exports
- `ftir.export_spectrum_csv` — S B
- `ftir.export_peaks_csv` — S B
- `ftir.export_match_results_csv` — S B

## Plate Reader

**Existing backend** (`app/routers/plate_reader.py`): status, sessions CRUD, sheet loading, MIC computation.

**Suggested action groups:**

### Sessions / files
- `plate.upload_session` — S B
- `plate.list_sessions` — S B
- `plate.delete_session` — D B
- `plate.get_session` — S B
- `plate.load_sheet` — S B (pick sheet + parsing options)

### MIC analysis
- `plate.run_mic` — S B (returns MIC values per well/group)
- `plate.set_mic_parameters` — S U (concentration series, blank wells, thresholds)
- `plate.export_mic_csv` — S B

### Plate view
- `plate.set_plate_view_settings` — S U (color scale, layout)
- `plate.highlight_wells` — S U
- `plate.annotate_well` — S U

### Workspace
- `plate.save_workspace` — S U
- `plate.load_workspace` — D U

## Data Studio

**Existing backend** (`app/routers/data_studio.py`): sessions, schema, preview, plot, histogram, load options.

**Suggested action groups:**

### Sessions / files
- `ds.upload_session` — S B
- `ds.list_sessions` — S B
- `ds.delete_session` — D B
- `ds.update_load_options` — S B (header row, separators, types)

### Schema / preview
- `ds.get_schema` — S B
- `ds.get_preview` — S B (head N rows with filters)

### Plotting
- `ds.get_plot_data` — S B (scatter/line; columns, filters)
- `ds.get_histogram` — S B
- `ds.set_plot_settings` — S U
- `ds.create_plot_and_show` — S * (compute + push to UI)

### Derived columns / filters
- `ds.add_derived_column` — S U (formula)
- `ds.remove_derived_column` — S U
- `ds.set_row_filter` — S U
- `ds.clear_filters` — C U

### Exports
- `ds.export_filtered_csv` — S B
- `ds.export_plot_png` — S B

## AI Assistant (the existing read-only tab)

**Existing backend** (`app/routers/ai.py`): status, context, chat.

The AI Assistant is the **consumer** of the action registry once phase 6 ships. Until then, its actions are mostly meta — managing chat state, providers, history. Treat it as a special case:

### Provider & settings
- `ai.list_providers` — S B
- `ai.set_provider` — S U (OpenAI / Anthropic / Ollama)
- `ai.set_model` — S U
- `ai.set_api_key` — S U (write-only, never returned)
- `ai.test_provider` — S B

### Chat
- `ai.get_context` — S B (what context the assistant sees)
- `ai.send_message` — S B (existing read-only path)
- `ai.clear_chat` — C U
- `ai.list_chats` — S U
- `ai.load_chat` — S U
- `ai.delete_chat` — D U

### Phase 6 additions (when tool-calling lands)
- `ai.set_auto_execute_safe` — S U
- `ai.set_show_tool_trace` — S U
- `ai.list_saved_prompts` — S U
- `ai.save_prompt` — S U
- `ai.run_saved_prompt` — varies (delegates to the action's own risk)
- `ai.list_macros` — S U (recorded action sequences)
- `ai.record_macro_start` / `ai.record_macro_stop` — S U
- `ai.run_macro` — C U (replays a saved sequence)

## Cross-Cutting Actions (not tied to a tab)

Once the registry has multiple tabs, a few global actions become useful:

- `app.list_tabs` — S B
- `app.switch_tab` — S U
- `app.get_global_state` — S B (active tab, loaded sessions per tab, theme)
- `app.set_theme` — S U (`day` / `night` / `night-vision`)
- `app.save_global_workspace` — S U (cross-tab workspace)
- `app.load_global_workspace` — D U
- `app.get_action_log` — S B (mirrors the per-action log endpoint)

---

## Template — Adding a New Tab to the Automation Layer

When the FTIR / Plate Reader / Data Studio / AI tab is ready to join the automation layer, use this checklist. Copy the section below and fill it in.

```
### <Tab Name> automation onboarding

Files surveyed:
- Backend router:       app/routers/<tab>.py
- Backend service:      app/services/<tab>_service.py
- Frontend view:        src/views/<Tab>View.tsx
- Pure analysis helpers (to extract in phase 1 equivalent):
  - [ ] <function name in view> → <new module name>
  - [ ] ...

Action catalog:
- [ ] List every existing UI button / dialog opener / setting toggle
- [ ] List every existing backend endpoint
- [ ] Cross-reference: every UI action and every endpoint must map to an action id
- [ ] Flag actions that need browser state (`U`) vs pure backend (`B`)
- [ ] Tag risk: S (auto), C (confirm), D (destructive)
- [ ] Identify combo actions (`*`) — compute on backend, push result to UI

Open design questions to resolve before implementation:
- [ ] Anything in <Tab>View.tsx that can't easily be expressed as a typed action?
- [ ] Any state that should move from React to backend to make actions cleaner?
- [ ] Any heavyweight computation that should stream results instead of blocking?

Review checkpoints (mirroring the LCMS process):
- [ ] Phase 1 equivalent — pure analysis extracted and unit-tested
- [ ] Phase 2 equivalent — backend actions registered, callable via curl
- [ ] Phase 3 — actions appear in MCP tool list (should be automatic)
- [ ] Phase 4 — browser-bridge handlers registered for `U`-scope actions
- [ ] Phase 5 — UI buttons rewired through the action registry
- [ ] Phase 6 — in-app assistant lists and calls the new tools
```

Once a tab's checklist is complete, move its entry from "Other-Tab Action Catalogs (TEMPLATE)" into the main catalog above and check it off in the Implementation Status section.
