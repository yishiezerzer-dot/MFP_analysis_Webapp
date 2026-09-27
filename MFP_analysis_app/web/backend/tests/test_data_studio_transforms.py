import numpy as np
import pandas as pd

from lab_gui.data_studio_io import apply_transform_steps


def test_baseline_with_leading_nan_warns_instead_of_wiping_column():
    df = pd.DataFrame({"y": [np.nan, 2.0, 3.0]})
    out = apply_transform_steps(df, [{"type": "baseline", "columns": ["y"], "method": "first"}])
    assert out["y"].tolist()[1:] == [2.0, 3.0]
    assert any("baseline" in w for w in out.attrs["transform_warnings"])


def test_decimal_comma_file_is_numeric(tmp_path):
    from lab_gui.data_studio_io import load_table, numeric_columns

    path = tmp_path / "comma.csv"
    path.write_text("t;y;label\n0;1,5;a\n1;2,5;b\n2;3,5;c\n", encoding="utf-8")
    df = load_table(path, decimal_comma=True)
    assert set(numeric_columns(df)) == {"t", "y"}
    assert df["y"].tolist() == [1.5, 2.5, 3.5]
    assert df["label"].tolist() == ["a", "b", "c"]


def test_ffill_fills_forward():
    df = pd.DataFrame({"y": [1.0, np.nan, 3.0]})
    out = apply_transform_steps(df, [{"type": "fillna", "columns": ["y"], "value": "ffill"}])
    assert out["y"].tolist() == [1.0, 1.0, 3.0]
    assert out.attrs["transform_warnings"] == []
