"""LCMS browser-scope and combo automation actions."""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from ..browser_bridge import browser_connections
from ..models import LCMSCreateEICInput, LCMSSumTICRegionSpectrumInput
from ..registry import ActionSpec, register
from .lcms_eic import create_eic
from .lcms_spectrum import sum_tic_region_spectrum


class BrowserActionOutput(BaseModel):
    ok: bool = True
    result: Dict[str, Any] = Field(default_factory=dict)


class BrowserOpenDialogInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dialog: Literal[
        "kendrick",
        "expected_products",
        "comparison_matrix",
        "feature_table",
        "polymer",
        "find_mz",
        "eic",
        "graph_settings",
    ]


class BrowserPushEICInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: Optional[str] = None
    source_file: Optional[str] = None
    eic: Dict[str, Any]
    metadata: Dict[str, Any] = Field(default_factory=dict)


class BrowserSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    settings: Dict[str, Any]


class BrowserFeatureRowInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row: Dict[str, Any]


class BrowserFeatureUpdateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    patch: Dict[str, Any]


class BrowserFeatureRemoveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str


class BrowserEmptyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BrowserUVLabelSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prominence: Optional[float] = None
    min_distance: Optional[float] = None
    orientation: Optional[Literal["vertical", "horizontal"]] = None
    stair_x_step: Optional[float] = None
    stair_y_step: Optional[float] = None
    bunch_labels: Optional[bool] = None
    bunch_hub_offset: Optional[float] = None
    snap_labels: Optional[bool] = None


class BrowserOptionalSessionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: Optional[str] = None


class BrowserAutoLabelUvInput(BrowserOptionalSessionInput):
    polymer_settings: Optional[dict] = None


class BrowserExportLabelsInput(BrowserOptionalSessionInput):
    polarity: Optional[Literal["positive", "negative"]] = None
    top_n: Optional[int] = None
    min_rel: Optional[float] = None


class BrowserExportSpectrumInput(BrowserOptionalSessionInput):
    rt_min: Optional[float] = None
    polarity: Optional[Literal["positive", "negative"]] = None


class BrowserExportTICOverlayInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_ids: Optional[List[str]] = None
    polarity: Optional[Literal["positive", "negative"]] = None


class BrowserCreateProjectInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None


class BrowserProjectIdInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str


class BrowserMoveSessionProjectInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    project_id: Optional[str] = None


class BrowserEICIdInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    eic_plot_id: str


class BrowserFeatureHighlightInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feature_row_id: Optional[str] = None
    eic_plot_id: Optional[str] = None


class BrowserSpectrumAtRTInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: Optional[str] = None
    rt_min: float
    polarity: Optional[Literal["positive", "negative"]] = None


class BrowserScanNavigationInput(BaseModel):
    """Navigation actions operate on the currently active session.

    There is no ``session_id`` field on purpose — passing one in earlier
    drafts silently navigated the *active* session anyway, which was a
    footgun. Callers that want to navigate a different session should first
    invoke ``lcms.select_session``.
    """

    model_config = ConfigDict(extra="forbid")


class BrowserSelectSessionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str


class BrowserPolarityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    polarity: Literal["all", "positive", "negative"]


class BrowserRTUnitInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rt_unit: Literal["minutes", "seconds"]


class BrowserOverlaySessionsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_ids: List[str]


class BrowserOverlaySpectrumInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: Optional[bool] = None


class BrowserEICOverlaySettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    settings: Dict[str, Any] = Field(default_factory=dict)
    enabled: Optional[bool] = None


class BrowserEICOverlayModeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: Optional[bool] = None


class CreateEICAndShowInput(LCMSCreateEICInput):
    source: Literal["dialog", "spectrum", "expected", "automation"] = "automation"
    source_file: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class CreateEICsForMassesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    masses: List[float] = Field(min_length=1, max_length=200)
    tolerance: float = Field(default=0.01, gt=0)
    polarity: Optional[Literal["positive", "negative"]] = None
    source_file: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ShowSummedRegionSpectrumInput(LCMSSumTICRegionSpectrumInput):
    pass


class CreateEICsForExpectedProductsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    products: List[Dict[str, Any]] = Field(min_length=1, max_length=200)
    default_tolerance: float = Field(default=0.01, gt=0)
    polarity: Optional[Literal["positive", "negative"]] = None


class CreateEICsForKendrickSeriesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    masses: List[float] = Field(min_length=1, max_length=200)
    tolerance: float = Field(default=0.01, gt=0)
    polarity: Optional[Literal["positive", "negative"]] = None
    series_id: Optional[int] = None


class IntegrateVisibleEICsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selected_rt: Optional[float] = None


async def _dispatch(action_id: str, args: BaseModel | Dict[str, Any]) -> BrowserActionOutput:
    if isinstance(args, BaseModel):
        payload = args.model_dump(mode="json")
    else:
        payload = args
    result = await browser_connections.dispatch(action_id, payload)
    return BrowserActionOutput(result=result)


def _browser_action(
    action_id: str,
    summary: str,
    input_model: type[BaseModel],
    *,
    risk: Literal["safe", "confirm", "destructive"] = "safe",
):
    return register(
        ActionSpec(
            id=action_id,
            summary=summary,
            input_model=input_model,
            output_model=BrowserActionOutput,
            risk=risk,
            scope="browser",
        )
    )


@_browser_action("lcms.push_eic_to_ui", "Push an EIC payload into the open LCMS browser view.", BrowserPushEICInput)
async def push_eic_to_ui(args: BrowserPushEICInput) -> BrowserActionOutput:
    return await _dispatch("lcms.push_eic_to_ui", args)


@_browser_action("lcms.get_polymer_settings", "Get the current LCMS polymer matching UI settings from the browser.", BrowserEmptyInput)
async def get_polymer_settings(args: BrowserEmptyInput) -> BrowserActionOutput:
    return await _dispatch("lcms.get_polymer_settings", args)


@_browser_action("lcms.set_polymer_settings", "Set LCMS polymer matching UI settings.", BrowserSettingsInput)
async def set_polymer_settings(args: BrowserSettingsInput) -> BrowserActionOutput:
    return await _dispatch("lcms.set_polymer_settings", args)


@_browser_action("lcms.add_feature_row", "Add a feature row in the open LCMS browser view.", BrowserFeatureRowInput)
async def add_feature_row(args: BrowserFeatureRowInput) -> BrowserActionOutput:
    return await _dispatch("lcms.add_feature_row", args)


@_browser_action("lcms.update_feature_row", "Update a feature row in the open LCMS browser view.", BrowserFeatureUpdateInput)
async def update_feature_row(args: BrowserFeatureUpdateInput) -> BrowserActionOutput:
    return await _dispatch("lcms.update_feature_row", args)


@_browser_action("lcms.remove_feature_row", "Remove a feature row in the open LCMS browser view.", BrowserFeatureRemoveInput)
async def remove_feature_row(args: BrowserFeatureRemoveInput) -> BrowserActionOutput:
    return await _dispatch("lcms.remove_feature_row", args)


@_browser_action("lcms.clear_features", "Clear integrated LCMS feature rows.", BrowserEmptyInput, risk="confirm")
async def clear_features(args: BrowserEmptyInput) -> BrowserActionOutput:
    return await _dispatch("lcms.clear_features", args)


@_browser_action("lcms.clear_eics", "Clear visible generated EIC plots.", BrowserEmptyInput, risk="confirm")
async def clear_eics(args: BrowserEmptyInput) -> BrowserActionOutput:
    return await _dispatch("lcms.clear_eics", args)


@_browser_action("lcms.export_labels_csv", "Export all-scan LCMS labels as CSV from the browser.", BrowserExportLabelsInput)
async def export_labels_csv(args: BrowserExportLabelsInput) -> BrowserActionOutput:
    return await _dispatch("lcms.export_labels_csv", args)


@_browser_action("lcms.export_spectrum_csv", "Export the current LCMS spectrum as CSV from the browser.", BrowserExportSpectrumInput)
async def export_spectrum_csv(args: BrowserExportSpectrumInput) -> BrowserActionOutput:
    return await _dispatch("lcms.export_spectrum_csv", args)


@_browser_action("lcms.export_uv_csv", "Export the attached UV chromatogram as CSV from the browser.", BrowserOptionalSessionInput)
async def export_uv_csv(args: BrowserOptionalSessionInput) -> BrowserActionOutput:
    return await _dispatch("lcms.export_uv_csv", args)


@_browser_action("lcms.export_tic_overlay_csv", "Export TIC overlays as CSV from the browser.", BrowserExportTICOverlayInput)
async def export_tic_overlay_csv(args: BrowserExportTICOverlayInput) -> BrowserActionOutput:
    return await _dispatch("lcms.export_tic_overlay_csv", args)


@_browser_action("lcms.open_uv_file_picker", "Open the UV chromatogram file picker.", BrowserEmptyInput)
async def open_uv_file_picker(args: BrowserEmptyInput) -> BrowserActionOutput:
    return await _dispatch("lcms.open_uv_file_picker", args)


@_browser_action("lcms.clear_uv", "Clear the attached UV chromatogram from the active session.", BrowserOptionalSessionInput)
async def clear_uv(args: BrowserOptionalSessionInput) -> BrowserActionOutput:
    return await _dispatch("lcms.clear_uv", args)


@_browser_action("lcms.auto_align_uv", "Run UV-to-MS auto alignment in the browser.", BrowserEmptyInput)
async def auto_align_uv(args: BrowserEmptyInput) -> BrowserActionOutput:
    return await _dispatch("lcms.auto_align_uv", args)


@_browser_action("lcms.auto_label_uv", "Auto-label UV peaks from nearby MS spectra. Pass session_id to label a specific session without switching the active view. Pass polymer_settings to override the active polymer settings for this labeling call.", BrowserAutoLabelUvInput)
async def auto_label_uv(args: BrowserAutoLabelUvInput) -> BrowserActionOutput:
    return await _dispatch("lcms.auto_label_uv", args)


@_browser_action("lcms.open_custom_uv_label", "Open the custom UV label dialog.", BrowserEmptyInput)
async def open_custom_uv_label(args: BrowserEmptyInput) -> BrowserActionOutput:
    return await _dispatch("lcms.open_custom_uv_label", args)


@_browser_action("lcms.clear_uv_labels", "Clear UV labels for the active LCMS session.", BrowserEmptyInput)
async def clear_uv_labels(args: BrowserEmptyInput) -> BrowserActionOutput:
    return await _dispatch("lcms.clear_uv_labels", args)


@_browser_action("lcms.create_project", "Create an LCMS project in the sidebar.", BrowserCreateProjectInput)
async def create_project(args: BrowserCreateProjectInput) -> BrowserActionOutput:
    return await _dispatch("lcms.create_project", args)


@_browser_action("lcms.delete_project", "Delete an LCMS project from the sidebar.", BrowserProjectIdInput)
async def delete_project(args: BrowserProjectIdInput) -> BrowserActionOutput:
    return await _dispatch("lcms.delete_project", args)


@_browser_action("lcms.move_session_to_project", "Move an LCMS session into a sidebar project.", BrowserMoveSessionProjectInput)
async def move_session_to_project(args: BrowserMoveSessionProjectInput) -> BrowserActionOutput:
    return await _dispatch("lcms.move_session_to_project", args)


@_browser_action("lcms.select_project", "Select an LCMS sidebar project.", BrowserProjectIdInput)
async def select_project(args: BrowserProjectIdInput) -> BrowserActionOutput:
    return await _dispatch("lcms.select_project", args)


@_browser_action("lcms.open_dialog", "Open an LCMS dialog in the browser.", BrowserOpenDialogInput)
async def open_dialog(args: BrowserOpenDialogInput) -> BrowserActionOutput:
    return await _dispatch("lcms.open_dialog", args)


@_browser_action("lcms.scroll_to_eic", "Scroll to an EIC plot in the browser.", BrowserEICIdInput)
async def scroll_to_eic(args: BrowserEICIdInput) -> BrowserActionOutput:
    return await _dispatch("lcms.scroll_to_eic", args)


@_browser_action("lcms.highlight_feature_row", "Highlight a feature row or its EIC plot.", BrowserFeatureHighlightInput)
async def highlight_feature_row(args: BrowserFeatureHighlightInput) -> BrowserActionOutput:
    return await _dispatch("lcms.highlight_feature_row", args)


@_browser_action("lcms.load_spectrum_at_rt", "Load the MS1 spectrum nearest an RT in the browser.", BrowserSpectrumAtRTInput)
async def load_spectrum_at_rt(args: BrowserSpectrumAtRTInput) -> BrowserActionOutput:
    return await _dispatch("lcms.load_spectrum_at_rt", args)


@_browser_action("lcms.next_scan", "Move to the next MS1 scan.", BrowserScanNavigationInput)
async def next_scan(args: BrowserScanNavigationInput) -> BrowserActionOutput:
    return await _dispatch("lcms.next_scan", args)


@_browser_action("lcms.previous_scan", "Move to the previous MS1 scan.", BrowserScanNavigationInput)
async def previous_scan(args: BrowserScanNavigationInput) -> BrowserActionOutput:
    return await _dispatch("lcms.previous_scan", args)


@_browser_action("lcms.first_scan", "Move to the first MS1 scan.", BrowserScanNavigationInput)
async def first_scan(args: BrowserScanNavigationInput) -> BrowserActionOutput:
    return await _dispatch("lcms.first_scan", args)


@_browser_action("lcms.last_scan", "Move to the last MS1 scan.", BrowserScanNavigationInput)
async def last_scan(args: BrowserScanNavigationInput) -> BrowserActionOutput:
    return await _dispatch("lcms.last_scan", args)


@_browser_action("lcms.jump_to_rt", "Jump to the nearest MS1 scan for an RT.", BrowserSpectrumAtRTInput)
async def jump_to_rt(args: BrowserSpectrumAtRTInput) -> BrowserActionOutput:
    return await _dispatch("lcms.jump_to_rt", args)


@_browser_action("lcms.select_session", "Select the active LCMS session in the browser.", BrowserSelectSessionInput)
async def select_session(args: BrowserSelectSessionInput) -> BrowserActionOutput:
    return await _dispatch("lcms.select_session", args)


@_browser_action("lcms.set_polarity", "Set LCMS polarity filter.", BrowserPolarityInput)
async def set_polarity(args: BrowserPolarityInput) -> BrowserActionOutput:
    return await _dispatch("lcms.set_polarity", args)


@_browser_action("lcms.set_rt_unit", "Set LCMS retention-time display unit.", BrowserRTUnitInput)
async def set_rt_unit(args: BrowserRTUnitInput) -> BrowserActionOutput:
    return await _dispatch("lcms.set_rt_unit", args)


@_browser_action("lcms.set_overlay_sessions", "Set LCMS overlay sessions.", BrowserOverlaySessionsInput)
async def set_overlay_sessions(args: BrowserOverlaySessionsInput) -> BrowserActionOutput:
    return await _dispatch("lcms.set_overlay_sessions", args)


@_browser_action("lcms.toggle_overlay_spectrum", "Toggle spectrum overlay mode.", BrowserOverlaySpectrumInput)
async def toggle_overlay_spectrum(args: BrowserOverlaySpectrumInput) -> BrowserActionOutput:
    return await _dispatch("lcms.toggle_overlay_spectrum", args)


@_browser_action("lcms.set_eic_overlay_settings", "Set EIC overlay analysis settings.", BrowserEICOverlaySettingsInput)
async def set_eic_overlay_settings(args: BrowserEICOverlaySettingsInput) -> BrowserActionOutput:
    return await _dispatch("lcms.set_eic_overlay_settings", args)


@_browser_action("lcms.toggle_eic_overlay_mode", "Toggle EIC overlay mode.", BrowserEICOverlayModeInput)
async def toggle_eic_overlay_mode(args: BrowserEICOverlayModeInput) -> BrowserActionOutput:
    return await _dispatch("lcms.toggle_eic_overlay_mode", args)


@_browser_action(
    "lcms.set_uv_label_settings",
    "Set UV chromatogram label settings (prominence, min_distance, orientation, spacing, bunching, snap). All fields optional — only provided fields are applied.",
    BrowserUVLabelSettingsInput,
)
async def set_uv_label_settings(args: BrowserUVLabelSettingsInput) -> BrowserActionOutput:
    return await _dispatch("lcms.set_uv_label_settings", args)


@_browser_action(
    "lcms.auto_arrange_uv_labels",
    "Trigger the auto-arrange stair layout on the current UV labels.",
    BrowserEmptyInput,
)
async def auto_arrange_uv_labels(args: BrowserEmptyInput) -> BrowserActionOutput:
    return await _dispatch("lcms.auto_arrange_uv_labels", args)


@register(
    ActionSpec(
        id="lcms.create_eic_and_show",
        summary="Create an EIC in the backend and show it in the open browser tab.",
        input_model=CreateEICAndShowInput,
        output_model=BrowserActionOutput,
        risk="safe",
        scope="both",
    )
)
async def create_eic_and_show(args: CreateEICAndShowInput) -> BrowserActionOutput:
    eic = await create_eic(
        LCMSCreateEICInput(
            session_id=args.session_id,
            mz=args.mz,
            tolerance=args.tolerance,
            polarity=args.polarity,
        )
    )
    payload = {
        "session_id": args.session_id,
        "source_file": args.source_file,
        "eic": eic.model_dump(mode="json"),
        "metadata": {"source": args.source, **args.metadata},
    }
    return await _dispatch("lcms.push_eic_to_ui", payload)


@register(
    ActionSpec(
        id="lcms.show_summed_region_spectrum",
        summary="Compute a summed TIC-region spectrum and show it in the browser.",
        input_model=ShowSummedRegionSpectrumInput,
        output_model=BrowserActionOutput,
        risk="safe",
        scope="both",
    )
)
async def show_summed_region_spectrum(args: ShowSummedRegionSpectrumInput) -> BrowserActionOutput:
    summed = await sum_tic_region_spectrum(LCMSSumTICRegionSpectrumInput.model_validate(args.model_dump(mode="json")))
    payload = {
        "session_id": args.session_id,
        "spectrum": {
            "meta": {
                "spectrum_id": f"summed:{summed.rt_min:.6f}-{summed.rt_max:.6f}",
                "rt_min": summed.rt_min,
                "rt_start": summed.rt_min,
                "rt_end": summed.rt_max,
                "tic": float(sum(summed.intensity)),
                "polarity": args.polarity,
                "n_peaks": len(summed.mz),
                "n_scans": summed.n_scans,
                "bin_width": summed.bin_width,
                "merge_mode": "sum",
            },
            "mz": summed.mz,
            "intensity": summed.intensity,
            "labels": [],
            "polymer_labels": [],
        },
    }
    return await _dispatch("lcms.show_summed_region_spectrum", payload)


@register(
    ActionSpec(
        id="lcms.create_eics_for_masses",
        summary="Create multiple EICs and show them in the browser.",
        input_model=CreateEICsForMassesInput,
        output_model=BrowserActionOutput,
        risk="safe",
        scope="both",
    )
)
async def create_eics_for_masses(args: CreateEICsForMassesInput) -> BrowserActionOutput:
    # Backend EIC computations are independent — fan out in parallel. Browser
    # pushes are kept sequential to avoid hammering the UI with concurrent
    # state mutations (React batching handles a sequential burst fine).
    eics = await asyncio.gather(
        *(
            create_eic(
                LCMSCreateEICInput(
                    session_id=args.session_id,
                    mz=float(mz),
                    tolerance=args.tolerance,
                    polarity=args.polarity,
                )
            )
            for mz in args.masses
        )
    )
    shown: List[Dict[str, Any]] = []
    for eic in eics:
        shown.append(
            await browser_connections.dispatch(
                "lcms.push_eic_to_ui",
                {
                    "session_id": args.session_id,
                    "source_file": args.source_file,
                    "eic": eic.model_dump(mode="json"),
                    "metadata": {"source": "automation", **args.metadata},
                },
            )
        )
    return BrowserActionOutput(result={"count": len(shown), "items": shown})


@register(
    ActionSpec(
        id="lcms.create_eics_for_expected_products",
        summary="Create EICs for expected-product hit payloads and show them.",
        input_model=CreateEICsForExpectedProductsInput,
        output_model=BrowserActionOutput,
        risk="safe",
        scope="both",
    )
)
async def create_eics_for_expected_products(args: CreateEICsForExpectedProductsInput) -> BrowserActionOutput:
    masses = [float(item["expected_mz"]) for item in args.products if item.get("expected_mz") is not None]
    return await create_eics_for_masses(
        CreateEICsForMassesInput(
            session_id=args.session_id,
            masses=masses,
            tolerance=args.default_tolerance,
            polarity=args.polarity,
            metadata={"source": "expected", "expectedProducts": args.products},
        )
    )


@register(
    ActionSpec(
        id="lcms.create_eics_for_kendrick_series",
        summary="Create EICs for masses in a Kendrick series and show them.",
        input_model=CreateEICsForKendrickSeriesInput,
        output_model=BrowserActionOutput,
        risk="safe",
        scope="both",
    )
)
async def create_eics_for_kendrick_series(args: CreateEICsForKendrickSeriesInput) -> BrowserActionOutput:
    return await create_eics_for_masses(
        CreateEICsForMassesInput(
            session_id=args.session_id,
            masses=args.masses,
            tolerance=args.tolerance,
            polarity=args.polarity,
            metadata={"source": "spectrum", "kendrickSeriesId": args.series_id},
        )
    )


@register(
    ActionSpec(
        id="lcms.integrate_visible_eics",
        summary="Integrate visible EIC plots in the open browser and add feature rows.",
        input_model=IntegrateVisibleEICsInput,
        output_model=BrowserActionOutput,
        risk="safe",
        scope="both",
    )
)
async def integrate_visible_eics(args: IntegrateVisibleEICsInput) -> BrowserActionOutput:
    return await _dispatch("lcms.integrate_visible_eics", args)
