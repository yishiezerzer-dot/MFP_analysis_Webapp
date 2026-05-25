import { z } from "zod";

const polarity = z.enum(["positive", "negative"]).optional();
const anyObject = z.record(z.string(), z.unknown());
const sessionId = z.object({ session_id: z.string().min(1) }).strict();
const spectrumRequest = sessionId.extend({ rt_min: z.number(), polarity });
const eicPayload = z.object({
  target_mz: z.number(),
  tolerance: z.number(),
  rt_min: z.array(z.number()),
  intensity: z.array(z.number()),
  polarity: z.array(z.string().nullable()).optional(),
  best: anyObject.optional(),
  n_scans: z.number().optional(),
});

export const lcmsActionSchemas = {
  "lcms.list_sessions": z.object({}).strict(),
  "lcms.get_session_state": sessionId,
  "lcms.get_tic": sessionId.extend({ polarity }),
  "lcms.get_spectrum_at_rt": spectrumRequest.extend({
    top_n: z.number().int().min(0).max(200).optional(),
    min_rel: z.number().min(0).max(1).optional(),
    polymer_settings: anyObject.optional(),
  }),
  "lcms.get_top_spectrum_peaks": spectrumRequest.extend({
    n: z.number().int().min(1).max(1000).optional(),
    min_rel: z.number().min(0).max(1).optional(),
  }),
  "lcms.find_mz": sessionId.extend({
    mz: z.number().positive(),
    tolerance: z.number().positive().optional(),
    polarity,
  }),
  "lcms.sum_tic_region_spectrum": sessionId.extend({
    rt_min: z.number(),
    rt_max: z.number(),
    polarity,
    bin_width: z.number().positive().optional(),
    min_rel: z.number().min(0).max(1).optional(),
    max_bins: z.number().int().min(100).max(200000).optional(),
  }),
  "lcms.create_eic": sessionId.extend({
    mz: z.number().positive(),
    tolerance: z.number().positive().optional(),
    polarity,
  }),
  "lcms.integrate_eic_data": z.object({
    session_id: z.string().optional(),
    eic: eicPayload,
    reference_rt: z.number().optional(),
  }).strict(),
  "lcms.compute_expected_products": spectrumRequest.extend({
    settings: anyObject,
    max_dp: z.number().int().min(1).max(200).optional(),
    resolution_mode: z.enum(["normal", "low"]).optional(),
    low_resolution_tolerance: z.number().positive().optional(),
  }),
  "lcms.match_polymers_for_spectrum": spectrumRequest.extend({ settings: anyObject }),
  "lcms.compute_kendrick_plot": spectrumRequest.extend({
    repeat_mass: z.number().positive(),
    min_rel_intensity: z.number().min(0).max(100).optional(),
    tolerance_value: z.number().positive().optional(),
    tolerance_unit: z.enum(["kmd", "ppm"]).optional(),
    min_series_points: z.number().int().min(1).max(1000).optional(),
  }),
  "lcms.build_comparison_matrix": z.object({
    rows: z.array(anyObject),
    metric: z.enum(["area", "height"]).optional(),
    group_mode: z.enum(["evidence", "mz"]).optional(),
    mz_tolerance: z.number().positive().optional(),
    normalize_rows: z.boolean().optional(),
  }).strict(),
  "lcms.export_feature_table_csv": z.object({
    session_id: z.string().optional(),
    rows: z.array(anyObject),
  }).strict(),
  "lcms.export_comparison_matrix_csv": z.object({
    session_id: z.string().optional(),
    rows: z.array(anyObject),
    metric: z.enum(["area", "height"]).optional(),
    group_mode: z.enum(["evidence", "mz"]).optional(),
    mz_tolerance: z.number().positive().optional(),
    normalize_rows: z.boolean().optional(),
  }).strict(),

  "lcms.push_eic_to_ui": z.object({
    session_id: z.string().optional().nullable(),
    source_file: z.string().optional().nullable(),
    eic: eicPayload,
    metadata: anyObject.optional(),
  }).strict(),
  "lcms.set_polymer_settings": z.object({ settings: anyObject }).strict(),
  "lcms.add_feature_row": z.object({ row: anyObject }).strict(),
  "lcms.update_feature_row": z.object({ id: z.string().min(1), patch: anyObject }).strict(),
  "lcms.remove_feature_row": z.object({ id: z.string().min(1) }).strict(),
  "lcms.clear_features": z.object({}).strict(),
  "lcms.clear_eics": z.object({}).strict(),
  "lcms.export_labels_csv": z.object({
    session_id: z.string().optional(),
    polarity,
    top_n: z.number().int().positive().optional(),
    min_rel: z.number().min(0).max(1).optional(),
  }).strict(),
  "lcms.export_spectrum_csv": z.object({
    session_id: z.string().optional(),
    rt_min: z.number().optional(),
    polarity,
  }).strict(),
  "lcms.export_uv_csv": z.object({ session_id: z.string().optional() }).strict(),
  "lcms.export_tic_overlay_csv": z.object({
    session_ids: z.array(z.string()).optional(),
    polarity,
  }).strict(),
  "lcms.open_uv_file_picker": z.object({}).strict(),
  "lcms.clear_uv": z.object({ session_id: z.string().optional() }).strict(),
  "lcms.auto_align_uv": z.object({}).strict(),
  "lcms.auto_label_uv": z.object({
    session_id: z.string().optional(),
    polymer_settings: anyObject.optional(),
  }).strict(),
  "lcms.open_custom_uv_label": z.object({}).strict(),
  "lcms.clear_uv_labels": z.object({}).strict(),
  "lcms.set_uv_label_settings": z.object({
    prominence: z.number().min(0).max(1).optional(),
    min_distance: z.number().min(0).optional(),
    orientation: z.enum(["vertical", "horizontal"]).optional(),
    stair_x_step: z.number().min(0).optional(),
    stair_y_step: z.number().min(0).optional(),
    bunch_labels: z.boolean().optional(),
    bunch_hub_offset: z.number().min(0).max(1).optional(),
    snap_labels: z.boolean().optional(),
  }).strict(),
  "lcms.auto_arrange_uv_labels": z.object({}).strict(),
  "lcms.create_project": z.object({ name: z.string().optional() }).strict(),
  "lcms.delete_project": z.object({ project_id: z.string().min(1) }).strict(),
  "lcms.move_session_to_project": z.object({
    session_id: z.string().min(1),
    project_id: z.string().optional().nullable(),
  }).strict(),
  "lcms.select_project": z.object({ project_id: z.string().min(1) }).strict(),
  "lcms.open_dialog": z.object({
    dialog: z.enum([
      "kendrick",
      "expected_products",
      "comparison_matrix",
      "feature_table",
      "polymer",
      "find_mz",
      "eic",
      "graph_settings",
    ]),
  }).strict(),
  "lcms.scroll_to_eic": z.object({ eic_plot_id: z.string().min(1) }).strict(),
  "lcms.highlight_feature_row": z.object({
    feature_row_id: z.string().optional(),
    eic_plot_id: z.string().optional(),
  }).strict(),
  // Navigation operates on the currently active session; matches the backend's
  // BrowserScanNavigationInput which forbids extra fields (no session_id).
  "lcms.load_spectrum_at_rt": z.object({
    session_id: z.string().optional(),
    rt_min: z.number(),
    polarity,
  }).strict(),
  "lcms.next_scan": z.object({}).strict(),
  "lcms.previous_scan": z.object({}).strict(),
  "lcms.first_scan": z.object({}).strict(),
  "lcms.last_scan": z.object({}).strict(),
  "lcms.jump_to_rt": z.object({
    session_id: z.string().optional(),
    rt_min: z.number(),
    polarity,
  }).strict(),
  "lcms.select_session": sessionId,
  "lcms.set_polarity": z.object({ polarity: z.enum(["all", "positive", "negative"]) }).strict(),
  "lcms.set_rt_unit": z.object({ rt_unit: z.enum(["minutes", "seconds"]) }).strict(),
  "lcms.set_overlay_sessions": z.object({ session_ids: z.array(z.string()) }).strict(),
  "lcms.toggle_overlay_spectrum": z.object({ enabled: z.boolean().optional() }).strict(),
  "lcms.set_eic_overlay_settings": z.object({
    settings: anyObject.optional(),
    enabled: z.boolean().optional(),
  }).strict(),
  "lcms.toggle_eic_overlay_mode": z.object({ enabled: z.boolean().optional() }).strict(),

  "lcms.create_eic_and_show": sessionId.extend({
    mz: z.number().positive(),
    tolerance: z.number().positive().optional(),
    polarity,
    source: z.enum(["dialog", "spectrum", "expected", "automation"]).optional(),
    source_file: z.string().optional().nullable(),
    metadata: anyObject.optional(),
  }),
  "lcms.show_summed_region_spectrum": sessionId.extend({
    rt_min: z.number(),
    rt_max: z.number(),
    polarity,
    bin_width: z.number().positive().optional(),
    min_rel: z.number().min(0).max(1).optional(),
    max_bins: z.number().int().min(100).max(200000).optional(),
  }),
  "lcms.create_eics_for_masses": sessionId.extend({
    masses: z.array(z.number().positive()).min(1).max(200),
    tolerance: z.number().positive().optional(),
    polarity,
    source_file: z.string().optional().nullable(),
    metadata: anyObject.optional(),
  }),
  "lcms.create_eics_for_expected_products": sessionId.extend({
    products: z.array(anyObject).min(1).max(200),
    default_tolerance: z.number().positive().optional(),
    polarity,
  }),
  "lcms.create_eics_for_kendrick_series": sessionId.extend({
    masses: z.array(z.number().positive()).min(1).max(200),
    tolerance: z.number().positive().optional(),
    polarity,
    series_id: z.number().int().optional().nullable(),
  }),
  "lcms.integrate_visible_eics": z.object({ selected_rt: z.number().optional().nullable() }).strict(),
} satisfies Record<string, z.ZodTypeAny>;

export type LCMSActionId = keyof typeof lcmsActionSchemas;
