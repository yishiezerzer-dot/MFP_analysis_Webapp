import numpy as np
import pandas as pd

from lab_gui.data_studio_io import apply_transform_steps


def test_baseline_with_leading_nan_warns_instead_of_wiping_column():
    df = pd.DataFrame({"y": [np.nan, 2.0, 3.0]})
    out = apply_transform_steps(df, [{"type": "baseline", "columns": ["y"], "method": "first"}])
    assert out["y"].tolist()[1:] == [2.0, 3.0]
    assert any("baseline" in w for w in out.attrs["transform_warnings"])
