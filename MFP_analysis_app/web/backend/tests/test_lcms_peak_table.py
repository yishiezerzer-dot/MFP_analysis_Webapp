"""The vectorised EIC / region-sum paths must give the same numbers as a straightforward
per-spectrum computation read directly with pyteomics."""
import base64
import zlib
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pyteomics import mzml

from app.db import get_session_record
from app.main import app
from app.services import lcms_service

client = TestClient(app)
N_SCANS = 40


def _mixed_polarity_mzml(seed: int = 3) -> bytes:
    rng = np.random.default_rng(seed)
    spectra = []
    for i in range(N_SCANS):
        n = int(rng.integers(20, 120))
        mz = np.sort(rng.uniform(100, 1000, n))
        mz[: 3] = [500.0 + rng.normal(0, 0.002), 500.003, 750.25]  # recurring ions for the EIC
        mz = np.sort(mz)
        inten = rng.exponential(100, n)
        pol = "MS:1000130\" name=\"positive scan" if i % 2 == 0 else "MS:1000129\" name=\"negative scan"
        enc = lambda a: base64.b64encode(zlib.compress(a.astype(np.float64).tobytes())).decode()
        spectra.append(f"""
      <spectrum id="scan={i}" index="{i}" defaultArrayLength="{n}">
        <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="1"/>
        <cvParam cvRef="MS" accession="{pol}" value=""/>
        <scanList count="1"><scan>
          <cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{i * 0.1}" unitName="minute"/>
        </scan></scanList>
        <binaryDataArrayList count="2">
          <binaryDataArray><cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
            <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
            <cvParam cvRef="MS" accession="MS:1000514" name="m/z array" value=""/><binary>{enc(mz)}</binary></binaryDataArray>
          <binaryDataArray><cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
            <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
            <cvParam cvRef="MS" accession="MS:1000515" name="intensity array" value=""/><binary>{enc(inten)}</binary></binaryDataArray>
        </binaryDataArrayList>
      </spectrum>""")
    return f"""<?xml version="1.0" encoding="utf-8"?>
<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0"><run id="r"><spectrumList count="{N_SCANS}">
{''.join(spectra)}
</spectrumList></run></mzML>""".encode()


@pytest.fixture(scope="module")
def session():
    resp = client.post("/api/lcms/sessions", files={"file": ("mixed.mzML", _mixed_polarity_mzml(), "application/octet-stream")})
    assert resp.status_code == 200, resp.text
    sid = resp.json()["session_id"]
    path = Path(get_session_record(sid)["file_path"])
    with mzml.MzML(str(path)) as reader:
        scans = [
            (float(s["scanList"]["scan"][0]["scan start time"]), "positive" if "positive scan" in s else "negative",
             np.asarray(s["m/z array"], float), np.asarray(s["intensity array"], float))
            for s in reader
        ]
    return sid, scans


def _ref_eic(scans, target, tol, polarity):
    rows = [(rt, float(np.nansum(it[np.abs(mz - target) <= tol]))) for rt, pol, mz, it in scans if polarity in (None, pol)]
    return [r for r, _ in rows], [v for _, v in rows]


@pytest.mark.parametrize("polarity", [None, "positive", "negative"])
@pytest.mark.parametrize("target,tol,unit", [(500.0, 0.01, "da"), (750.25, 20, "ppm"), (333.3, 0.5, "da")])
def test_eic_matches_reference(session, polarity, target, tol, unit):
    sid, scans = session
    body = {"mz": target, "tolerance": tol, "tolerance_unit": unit}
    if polarity:
        body["polarity"] = polarity
    out = client.post(f"/api/lcms/sessions/{sid}/eic", json=body).json()
    tol_da = tol * 1e-6 * target if unit == "ppm" else tol
    rts, ints = _ref_eic(scans, target, tol_da, polarity)
    assert out["rt_min"] == pytest.approx(rts)
    assert out["intensity"] == pytest.approx(ints, rel=1e-6, abs=1e-9)
    assert out["n_scans"] == len(rts)
    if max(ints) > 0:
        assert out["best"]["rt_min"] == pytest.approx(rts[int(np.argmax(ints))])
        assert out["best"]["intensity"] == pytest.approx(max(ints), rel=1e-6)


@pytest.mark.parametrize("polarity", [None, "negative"])
def test_region_sum_matches_reference(session, polarity):
    sid, scans = session
    lo, hi, width = 0.95, 2.55, 0.01
    body = {"rt_min": lo, "rt_max": hi, "bin_width": width}
    if polarity:
        body["polarity"] = polarity
    out = client.post(f"/api/lcms/sessions/{sid}/region-spectrum", json=body).json()

    totals, weighted = {}, {}
    n = 0
    for rt, pol, mz, it in scans:
        if lo <= rt <= hi and polarity in (None, pol):
            n += 1
            for m, v in zip(mz, it):
                k = int(np.rint(m / width))
                totals[k] = totals.get(k, 0.0) + v
                weighted[k] = weighted.get(k, 0.0) + m * v
    ref = sorted((weighted[k] / totals[k], totals[k]) for k in totals)
    assert out["n_scans"] == n
    assert out["mz"] == pytest.approx([m for m, _ in ref], rel=1e-9)
    assert out["intensity"] == pytest.approx([v for _, v in ref], rel=1e-6)


def test_peak_table_is_cached_on_disk_and_removed_with_session(session):
    sid, _ = session
    state = lcms_service.registry.get(sid)
    base = lcms_service._peak_table_base(state)
    assert base is not None and any(base.parent.glob(base.name + "*"))
    client.delete(f"/api/lcms/sessions/{sid}")
    assert not any(base.parent.glob(base.name + "*"))
