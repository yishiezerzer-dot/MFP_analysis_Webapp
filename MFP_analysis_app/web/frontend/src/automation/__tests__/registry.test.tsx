import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserBridgeProvider, useBrowserAutomation } from "../BrowserBridge";
import {
  refreshAutomationCatalog,
  resetAutomationCatalogForTests,
  useAutomationDispatch,
} from "../registry";
import { automationActionSchemas, type AutomationActionId } from "../schemas";

const CATALOG = [
  {
    id: "lcms.list_sessions",
    summary: "List loaded LCMS sessions.",
    input_schema: {},
    output_schema: {},
    risk: "safe",
    scope: "backend",
  },
  {
    id: "lcms.find_mz",
    summary: "Find a target m/z across indexed MS1 scans.",
    input_schema: {},
    output_schema: {},
    risk: "safe",
    scope: "backend",
  },
  {
    id: "lcms.open_dialog",
    summary: "Open an LCMS dialog in the browser.",
    input_schema: {},
    output_schema: {},
    risk: "safe",
    scope: "browser",
  },
];

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  (globalThis as { fetch: typeof fetch }).fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  ) as unknown as typeof fetch;
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <BrowserBridgeProvider>{children}</BrowserBridgeProvider>;
}

beforeEach(() => {
  resetAutomationCatalogForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAutomationDispatch routing", () => {
  it("routes backend-scope actions to the HTTP execute endpoint", async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url.endsWith("/api/automation/actions")) {
        return new Response(JSON.stringify(CATALOG), { status: 200 });
      }
      if (url.endsWith("/lcms.list_sessions/execute")) {
        return new Response(JSON.stringify({ sessions: [{ session_id: "s1" }] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const { result } = renderHook(() => useAutomationDispatch(), { wrapper });
    let payload: unknown;
    await act(async () => {
      payload = await result.current("lcms.list_sessions", {});
    });

    expect(payload).toEqual({ sessions: [{ session_id: "s1" }] });
    expect(calls.some((c) => c.endsWith("/lcms.list_sessions/execute"))).toBe(true);
  });

  it("routes browser-scope actions to the local handler (no HTTP)", async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url.endsWith("/api/automation/actions")) {
        return new Response(JSON.stringify(CATALOG), { status: 200 });
      }
      throw new Error(`browser-scope action should not hit HTTP; got ${url}`);
    });

    let registeredArgs: unknown = null;
    function Inner() {
      const dispatch = useAutomationDispatch();
      const browser = useBrowserAutomation();
      browser.register("lcms.open_dialog", (args: Record<string, unknown>) => {
        registeredArgs = args;
        return { opened: args.dialog };
      });
      return dispatch;
    }
    const { result } = renderHook(() => Inner(), { wrapper });

    let payload: unknown;
    await act(async () => {
      payload = await result.current("lcms.open_dialog", { dialog: "kendrick" });
    });
    expect(payload).toEqual({ opened: "kendrick" });
    expect(registeredArgs).toEqual({ dialog: "kendrick" });
    // Only the catalog fetch should appear.
    expect(calls.filter((c) => !c.endsWith("/api/automation/actions"))).toEqual([]);
  });

  it("rejects malformed args via zod before any network call", async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url.endsWith("/api/automation/actions")) {
        return new Response(JSON.stringify(CATALOG), { status: 200 });
      }
      return new Response("should not reach", { status: 500 });
    });

    const { result } = renderHook(() => useAutomationDispatch(), { wrapper });
    await expect(
      act(async () => {
        // find_mz requires `mz: positive number`; -1 fails the schema.
        await result.current("lcms.find_mz", { session_id: "s1", mz: -1 });
      }),
    ).rejects.toBeDefined();

    expect(calls.filter((c) => !c.endsWith("/api/automation/actions"))).toEqual([]);
  });

  it("caches the catalog across multiple dispatches", async () => {
    const catalogFetches = { count: 0 };
    mockFetch((url) => {
      if (url.endsWith("/api/automation/actions")) {
        catalogFetches.count += 1;
        return new Response(JSON.stringify(CATALOG), { status: 200 });
      }
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
    });

    const { result } = renderHook(() => useAutomationDispatch(), { wrapper });
    await act(async () => {
      await result.current("lcms.list_sessions", {});
      await result.current("lcms.list_sessions", {});
      await result.current("lcms.list_sessions", {});
    });
    expect(catalogFetches.count).toBe(1);
  });

  it("refreshAutomationCatalog forces a re-fetch on next dispatch", async () => {
    const catalogFetches = { count: 0 };
    mockFetch((url) => {
      if (url.endsWith("/api/automation/actions")) {
        catalogFetches.count += 1;
        return new Response(JSON.stringify(CATALOG), { status: 200 });
      }
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
    });
    const { result } = renderHook(() => useAutomationDispatch(), { wrapper });
    await act(async () => {
      await result.current("lcms.list_sessions", {});
    });
    refreshAutomationCatalog();
    await act(async () => {
      await result.current("lcms.list_sessions", {});
    });
    expect(catalogFetches.count).toBe(2);
  });
});

describe("schema coverage — every action's representative call payload parses", () => {
  // For each schema id, a payload that the LCMS UI is known to send. This is
  // the test that catches drift like the export_comparison_matrix_csv bug
  // before users click the button.
  const payloads: Record<AutomationActionId, unknown> = {
    "lcms.list_sessions": {},
    "lcms.get_session_state": { session_id: "s1" },
    "lcms.get_tic": { session_id: "s1" },
    "lcms.get_spectrum_at_rt": { session_id: "s1", rt_min: 1.0, top_n: 8, min_rel: 0.01 },
    "lcms.get_top_spectrum_peaks": { session_id: "s1", rt_min: 1.0, n: 8, min_rel: 0.01 },
    "lcms.find_mz": { session_id: "s1", mz: 150.1, tolerance: 0.02 },
    "lcms.sum_tic_region_spectrum": { session_id: "s1", rt_min: 0.5, rt_max: 1.5 },
    "lcms.create_eic": { session_id: "s1", mz: 150.1, tolerance: 0.02 },
    "lcms.integrate_eic_data": {
      eic: { target_mz: 150.1, tolerance: 0.02, rt_min: [0, 1, 2], intensity: [0, 50, 0] },
    },
    "lcms.compute_expected_products": {
      session_id: "s1",
      rt_min: 1.0,
      polarity: "positive",
      settings: { enabled: true, monomers_text: "A 100.0" },
      max_dp: 3,
    },
    "lcms.match_polymers_for_spectrum": {
      session_id: "s1",
      rt_min: 1.0,
      polarity: "positive",
      settings: { enabled: true },
    },
    "lcms.compute_kendrick_plot": {
      session_id: "s1",
      rt_min: 1.0,
      polarity: "positive",
      repeat_mass: 14.0157,
    },
    "lcms.build_comparison_matrix": { rows: [], metric: "area", group_mode: "evidence" },
    "lcms.export_feature_table_csv": { rows: [] },
    "lcms.export_comparison_matrix_csv": {
      rows: [],
      metric: "area",
      group_mode: "evidence",
      mz_tolerance: 0.05,
      normalize_rows: false,
    },
    "lcms.push_eic_to_ui": {
      eic: { target_mz: 150.1, tolerance: 0.02, rt_min: [0, 1], intensity: [0, 50] },
    },
    "lcms.get_polymer_settings": {},
    "lcms.set_polymer_settings": { settings: {} },
    "lcms.add_feature_row": { row: {} },
    "lcms.update_feature_row": { id: "f1", patch: {} },
    "lcms.remove_feature_row": { id: "f1" },
    "lcms.clear_features": {},
    "lcms.clear_eics": {},
    "lcms.export_labels_csv": {},
    "lcms.export_spectrum_csv": {},
    "lcms.export_uv_csv": {},
    "lcms.export_tic_overlay_csv": {},
    "lcms.open_uv_file_picker": {},
    "lcms.clear_uv": {},
    "lcms.auto_align_uv": {},
    "lcms.auto_label_uv": {},
    "lcms.open_custom_uv_label": {},
    "lcms.clear_uv_labels": {},
    "lcms.set_uv_label_settings": { prominence: 0.05, orientation: "vertical" },
    "lcms.auto_arrange_uv_labels": {},
    "lcms.create_project": { name: "Project A" },
    "lcms.delete_project": { project_id: "p1" },
    "lcms.move_session_to_project": { session_id: "s1", project_id: "p1" },
    "lcms.select_project": { project_id: "p1" },
    "lcms.open_dialog": { dialog: "kendrick" },
    "lcms.scroll_to_eic": { eic_plot_id: "eic-1" },
    "lcms.highlight_feature_row": { feature_row_id: "f1" },
    "lcms.load_spectrum_at_rt": { rt_min: 1.0 },
    "lcms.next_scan": {},
    "lcms.previous_scan": {},
    "lcms.first_scan": {},
    "lcms.last_scan": {},
    "lcms.jump_to_rt": { rt_min: 1.0 },
    "lcms.select_session": { session_id: "s1" },
    "lcms.set_polarity": { polarity: "positive" },
    "lcms.set_rt_unit": { rt_unit: "minutes" },
    "lcms.set_overlay_sessions": { session_ids: ["s1", "s2"] },
    "lcms.toggle_overlay_spectrum": { enabled: true },
    "lcms.set_eic_overlay_settings": { settings: {}, enabled: true },
    "lcms.toggle_eic_overlay_mode": { enabled: true },
    "lcms.create_eic_and_show": { session_id: "s1", mz: 150.1, tolerance: 0.02 },
    "lcms.show_summed_region_spectrum": { session_id: "s1", rt_min: 0.5, rt_max: 1.5 },
    "lcms.create_eics_for_masses": { session_id: "s1", masses: [150.1, 200.1] },
    "lcms.create_eics_for_expected_products": {
      session_id: "s1",
      products: [{ expected_mz: 150.1 }],
    },
    "lcms.create_eics_for_kendrick_series": { session_id: "s1", masses: [150.1] },
    "lcms.integrate_visible_eics": {},
  };

  for (const [actionId, payload] of Object.entries(payloads)) {
    it(`${actionId} representative payload parses`, () => {
      const schema = automationActionSchemas[actionId as AutomationActionId];
      const result = schema.safeParse(payload);
      if (!result.success) {
        // Print issues so the test failure is actionable.
        // eslint-disable-next-line no-console
        console.log(`zod errors for ${actionId}:`, result.error.issues);
      }
      expect(result.success).toBe(true);
    });
  }

  it("every schema id is exercised by a payload above (no drift in coverage)", () => {
    const schemaIds = new Set(Object.keys(automationActionSchemas));
    const payloadIds = new Set(Object.keys(payloads));
    const missing = [...schemaIds].filter((id) => !payloadIds.has(id));
    expect(missing).toEqual([]);
  });
});
