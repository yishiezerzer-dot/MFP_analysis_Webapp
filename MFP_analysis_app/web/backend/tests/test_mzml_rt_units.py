from pathlib import Path

import pytest

from lab_gui.lcms_io import MzMLTICIndex
from test_mzml_fast_index import _generate_synthetic_mzml


def _write(tmp_path: Path, unit_attr: str, step: float) -> Path:
    xml = _generate_synthetic_mzml(num_scans=11).decode("utf-8")
    xml = xml.replace('unitName="minute"', unit_attr)
    for i in range(11):
        xml = xml.replace(f'name="scan start time" value="{i * 0.05}"', f'name="scan start time" value="{i * step}"')
    path = tmp_path / f"rt_{abs(hash(unit_attr))}_{step}.mzML"
    path.write_text(xml, encoding="utf-8")
    return path


def _range(path: Path, rt_unit: str):
    idx = MzMLTICIndex(path, rt_unit=rt_unit, use_cache=False)
    idx.build()
    return idx.ms1[0].rt_min, idx.ms1[-1].rt_min, idx.stats


@pytest.mark.parametrize("fallback", ["minutes", "seconds"])
def test_file_declaring_seconds_is_converted_regardless_of_fallback(tmp_path, fallback):
    lo, hi, stats = _range(_write(tmp_path, 'unitName="second"', 120.0), fallback)
    assert (lo, hi) == pytest.approx((0.0, 20.0))
    assert stats["rt_unit_source"] == "file"


@pytest.mark.parametrize("fallback", ["minutes", "seconds"])
def test_file_declaring_minutes_is_not_rescaled(tmp_path, fallback):
    lo, hi, stats = _range(_write(tmp_path, 'unitName="minute"', 2.0), fallback)
    assert (lo, hi) == pytest.approx((0.0, 20.0))
    assert stats["rt_unit_source"] == "file"


def test_file_without_unit_uses_fallback(tmp_path):
    path = _write(tmp_path, "", 120.0)
    lo, hi, stats = _range(path, "seconds")
    assert (lo, hi) == pytest.approx((0.0, 20.0))
    assert stats["rt_unit_source"] == "fallback"
