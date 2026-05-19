"""Shared Pydantic models for automation action execution."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


ActionRisk = Literal["safe", "confirm", "destructive"]
ActionScope = Literal["backend", "browser", "both"]


class EmptyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ActionPreview(BaseModel):
    action_id: str
    risk: ActionRisk
    affected_session_ids: List[str] = Field(default_factory=list)
    estimated_duration_ms: Optional[int] = None
    warnings: List[str] = Field(default_factory=list)
    confirmation_token: Optional[str] = None
    expires_at: Optional[datetime] = None


class ActionError(BaseModel):
    action_id: Optional[str] = None
    error: str
    detail: Any = None


class ActionResult(BaseModel):
    action_id: str
    result: Dict[str, Any] = Field(default_factory=dict)


class ActionLogEntry(BaseModel):
    timestamp: datetime
    action_id: str
    args_summary: Dict[str, Any]
    status: str
    duration_ms: float
    result_summary: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class LCMSUVSummary(BaseModel):
    available: bool
    filename: Optional[str] = None
    path: Optional[str] = None
    n_points: Optional[int] = None
    rt_min: Optional[float] = None
    rt_max: Optional[float] = None
    x_col: Optional[str] = None
    y_col: Optional[str] = None
    x_label: Optional[str] = None
    y_label: Optional[str] = None
    unit_guess: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


class LCMSSessionSummary(BaseModel):
    session_id: str
    display_name: str
    path: str
    ms1_count: int
    rt_min: Optional[float] = None
    rt_max: Optional[float] = None
    polarities: List[str] = Field(default_factory=list)
    stats: Dict[str, Any] = Field(default_factory=dict)
    uv: LCMSUVSummary


class LCMSListSessionsOutput(BaseModel):
    sessions: List[LCMSSessionSummary]


class LCMSSessionIdInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1)


class LCMSSpectrumMeta(BaseModel):
    spectrum_id: str
    rt_min: float
    tic: float
    polarity: Optional[str] = None


class LCMSGetSessionStateOutput(BaseModel):
    session: LCMSSessionSummary
    ms1_meta: List[LCMSSpectrumMeta]


class LCMSGetTICInput(LCMSSessionIdInput):
    polarity: Optional[Literal["positive", "negative"]] = None


class LCMSGetTICOutput(BaseModel):
    session_id: str
    display_name: str
    rt_min: List[float]
    tic: List[float]
    polarity: List[Optional[str]]


class LCMSSpectrumRequestBase(LCMSSessionIdInput):
    rt_min: float
    polarity: Optional[Literal["positive", "negative"]] = None


class LCMSGetSpectrumAtRTInput(LCMSSpectrumRequestBase):
    top_n: int = Field(default=10, ge=0, le=200)
    min_rel: float = Field(default=0.01, ge=0, le=1)
    polymer_settings: Optional[Dict[str, Any]] = None


class LCMSSpectrumMetaDetailed(BaseModel):
    spectrum_id: str
    rt_min: float
    tic: float
    polarity: Optional[str] = None
    n_peaks: int


class LCMSSpectrumPeak(BaseModel):
    mz: float
    intensity: float
    text: Optional[str] = None
    kind: Optional[str] = None
    abs_err: Optional[float] = None
    source: Optional[str] = None
    peak_index: Optional[int] = None


class LCMSGetSpectrumAtRTOutput(BaseModel):
    meta: LCMSSpectrumMetaDetailed
    mz: List[float]
    intensity: List[float]
    labels: List[Dict[str, Any]] = Field(default_factory=list)
    polymer_labels: List[Dict[str, Any]] = Field(default_factory=list)


class LCMSTopSpectrumPeaksInput(LCMSSpectrumRequestBase):
    n: int = Field(default=10, ge=1, le=1000)
    min_rel: float = Field(default=0.0, ge=0, le=1)


class LCMSTopSpectrumPeaksOutput(BaseModel):
    meta: LCMSSpectrumMetaDetailed
    peaks: List[LCMSSpectrumPeak]


class LCMSFindMzInput(LCMSSessionIdInput):
    mz: float = Field(gt=0)
    tolerance: float = Field(default=0.01, gt=0)
    polarity: Optional[Literal["positive", "negative"]] = None


class LCMSBestMzMatch(BaseModel):
    rt_min: Optional[float] = None
    intensity: float
    mz: Optional[float] = None
    spectrum_id: Optional[str] = None
    polarity: Optional[str] = None


class LCMSFindMzOutput(BaseModel):
    target_mz: float
    tolerance: float
    n_scans: int
    best: LCMSBestMzMatch


class LCMSSumTICRegionSpectrumInput(LCMSSessionIdInput):
    rt_min: float
    rt_max: float
    polarity: Optional[Literal["positive", "negative"]] = None
    bin_width: float = Field(default=0.01, gt=0)
    min_rel: float = Field(default=0.0, ge=0, le=1)
    max_bins: int = Field(default=25000, ge=100, le=200000)


class LCMSSumTICRegionSpectrumOutput(BaseModel):
    rt_min: float
    rt_max: float
    bin_width: float
    n_scans: int
    mz: List[float]
    intensity: List[float]


class LCMSEICPayload(BaseModel):
    target_mz: float
    tolerance: float
    rt_min: List[float]
    intensity: List[float]
    polarity: List[Optional[str]] = Field(default_factory=list)
    best: Optional[Dict[str, Any]] = None
    n_scans: Optional[int] = None


class LCMSCreateEICInput(LCMSFindMzInput):
    pass


class LCMSCreateEICOutput(LCMSEICPayload):
    best: LCMSBestMzMatch
    n_scans: int


class LCMSIntegrateEICDataInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # session_id is optional: integrating an EIC payload is stateless, but
    # callers can still tag the request with the session it came from for
    # auditability. If supplied, the registry validates the session exists.
    session_id: Optional[str] = None
    eic: LCMSEICPayload
    reference_rt: Optional[float] = None


class LCMSIntegrateEICDataOutput(BaseModel):
    rt_start: float
    rt_apex: float
    rt_end: float
    height: float
    area: float
    baseline: float
    n_points: int


class LCMSSpectrumPolymerInput(LCMSSpectrumRequestBase):
    settings: Dict[str, Any]


class LCMSMatchPolymersForSpectrumOutput(BaseModel):
    meta: LCMSSpectrumMetaDetailed
    labels: List[Dict[str, Any]]


class LCMSExpectedProductsInput(LCMSSpectrumRequestBase):
    settings: Dict[str, Any]
    max_dp: int = Field(default=3, ge=1, le=200)
    resolution_mode: Literal["normal", "low"] = "normal"
    low_resolution_tolerance: float = Field(default=0.2, gt=0)


class LCMSExpectedProductHit(BaseModel):
    id: str
    composition: str
    neutral_mass: float
    variant: str
    ion: str
    expected_mz: float
    tolerance_da: float
    observed_mz: Optional[float] = None
    intensity: Optional[float] = None
    abs_err: Optional[float] = None
    ppm_err: Optional[float] = None


class LCMSComputeExpectedProductsOutput(BaseModel):
    meta: LCMSSpectrumMetaDetailed
    hits: List[LCMSExpectedProductHit]


class LCMSComputeKendrickPlotInput(LCMSSpectrumRequestBase):
    repeat_mass: float = Field(gt=0)
    min_rel_intensity: float = Field(default=1.0, ge=0, le=100)
    tolerance_value: float = Field(default=0.01, gt=0)
    tolerance_unit: Literal["kmd", "ppm"] = "kmd"
    min_series_points: int = Field(default=3, ge=1, le=1000)


class LCMSKendrickPoint(BaseModel):
    id: str
    mz: float
    intensity: float
    rel_intensity: float
    kendrick_mass: float
    kendrick_nominal_mass: int
    kmd: float
    series_id: Optional[int] = None


class LCMSKendrickSeries(BaseModel):
    id: int
    center: float
    count: int
    max_intensity: float


class LCMSComputeKendrickPlotOutput(BaseModel):
    meta: LCMSSpectrumMetaDetailed
    repeat_mass: float
    nominal_repeat_mass: int
    points: List[LCMSKendrickPoint]
    series: List[LCMSKendrickSeries]
    truncated: bool


class LCMSFeatureRow(BaseModel):
    id: str
    eic_plot_id: Optional[str] = None
    session_id: Optional[str] = None
    source_file: str = ""
    mz: float
    tolerance: float = 0.0
    polarity: Optional[str] = None
    rt_start: float = 0.0
    rt_apex: float
    rt_end: float = 0.0
    height: float
    area: float
    baseline: float = 0.0
    n_points: int = 0
    source: str = "manual"
    label: Optional[str] = None
    expected_product: Optional[str] = None
    annotation: Optional[str] = None
    created_at: Optional[str] = None


class LCMSBuildComparisonMatrixInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # session_id is optional: comparison matrices are computed from the rows
    # the caller supplies (which already carry their own session_id per row).
    # When provided, the registry validates the session exists.
    session_id: Optional[str] = None
    rows: List[LCMSFeatureRow]
    metric: Literal["area", "height"] = "area"
    group_mode: Literal["evidence", "mz"] = "evidence"
    mz_tolerance: float = Field(default=0.05, gt=0)


class LCMSFeatureMatrixCell(BaseModel):
    row: LCMSFeatureRow
    collisions: List[LCMSFeatureRow] = Field(default_factory=list)


class LCMSFeatureMatrixGroup(BaseModel):
    id: str
    label: str
    annotation: str
    polarity: Optional[str] = None
    mz: float
    rt_apex: float
    anchor_mz: float
    rt_min: float
    rt_max: float
    rows: List[LCMSFeatureRow]
    cells: Dict[str, LCMSFeatureMatrixCell]


class LCMSBuildComparisonMatrixOutput(BaseModel):
    groups: List[LCMSFeatureMatrixGroup]
    column_ids: List[str]
    column_labels: Dict[str, str]


class LCMSExportFeatureTableCSVInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: Optional[str] = None
    rows: List[LCMSFeatureRow]


class LCMSExportCSVOutput(BaseModel):
    filename: str
    content_type: str = "text/csv;charset=utf-8"
    csv: str


class LCMSExportComparisonMatrixCSVInput(LCMSBuildComparisonMatrixInput):
    normalize_rows: bool = False
