import base64
import tempfile
import zlib
from pathlib import Path

import numpy as np
import pytest

from lab_gui.lcms_io import MzMLTICIndex


def _generate_synthetic_mzml(num_scans: int = 15, with_tic_cv: bool = True) -> bytes:
    mz_arr = np.linspace(100, 1000, 50, dtype=np.float64)
    int_arr = np.array([25.0] * 50, dtype=np.float64)

    mz_b64 = base64.b64encode(zlib.compress(mz_arr.tobytes())).decode("ascii")
    int_b64 = base64.b64encode(zlib.compress(int_arr.tobytes())).decode("ascii")

    spectra = []
    for i in range(num_scans):
        tic_xml = (
            f'<cvParam cvRef="MS" accession="MS:1000285" name="total ion current" value="{1250.0 + i * 5}"/>'
            if with_tic_cv
            else ""
        )
        spectra.append(f"""
      <spectrum id="scan={i}" index="{i}" defaultArrayLength="50">
        <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="1"/>
        <cvParam cvRef="MS" accession="MS:1000130" name="positive scan" value=""/>
        {tic_xml}
        <scanList count="1">
          <scan>
            <cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{i * 0.05}" unitName="minute"/>
          </scan>
        </scanList>
        <binaryDataArrayList count="2">
          <binaryDataArray encodedLength="{len(mz_b64)}">
            <cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
            <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
            <cvParam cvRef="MS" accession="MS:1000514" name="m/z array" value=""/>
            <binary>{mz_b64}</binary>
          </binaryDataArray>
          <binaryDataArray encodedLength="{len(int_b64)}">
            <cvParam cvRef="MS" accession="MS:1000574" name="zlib compression" value=""/>
            <cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/>
            <cvParam cvRef="MS" accession="MS:1000515" name="intensity array" value=""/>
            <binary>{int_b64}</binary>
          </binaryDataArray>
        </binaryDataArrayList>
      </spectrum>
        """)

    return f"""<?xml version="1.0" encoding="utf-8"?>
<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">
  <run id="run1">
    <spectrumList count="{num_scans}">
      {''.join(spectra)}
    </spectrumList>
  </run>
</mzML>""".encode("utf-8")


def test_mzml_fast_index_with_cv_param():
    xml = _generate_synthetic_mzml(num_scans=10, with_tic_cv=True)
    with tempfile.NamedTemporaryFile(suffix=".mzML", delete=False) as f:
        f.write(xml)
        tmp_path = Path(f.name)

    try:
        # 1. First build (fast header reading)
        idx = MzMLTICIndex(tmp_path, use_cache=True)
        idx.build()
        assert len(idx.ms1) == 10
        assert idx.stats.get("cached") is False
        assert abs(idx.ms1[0].tic - 1250.0) < 1e-3

        # 2. Second build (should hit cache)
        idx2 = MzMLTICIndex(tmp_path, use_cache=True)
        idx2.build()
        assert len(idx2.ms1) == 10
        assert idx2.stats.get("cached") is True
        assert abs(idx2.ms1[0].tic - 1250.0) < 1e-3
    finally:
        try:
            tmp_path.unlink()
        except Exception:
            pass


def test_mzml_fast_index_fallback_without_cv_param():
    # Without total ion current CV param, it must decode intensity array on demand
    xml = _generate_synthetic_mzml(num_scans=5, with_tic_cv=False)
    with tempfile.NamedTemporaryFile(suffix=".mzML", delete=False) as f:
        f.write(xml)
        tmp_path = Path(f.name)

    try:
        idx = MzMLTICIndex(tmp_path, use_cache=False)
        idx.build()
        assert len(idx.ms1) == 5
        # 50 peaks of intensity 25.0 = 1250.0
        assert abs(idx.ms1[0].tic - 1250.0) < 1e-3
    finally:
        try:
            tmp_path.unlink()
        except Exception:
            pass
