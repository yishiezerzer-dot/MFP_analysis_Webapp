from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_MFP_ROOT = _REPO_ROOT / "MFP_analysis_app"
_BACKEND_ROOT = _MFP_ROOT / "web" / "backend"

for path in (_MFP_ROOT, _BACKEND_ROOT):
    text = str(path)
    if text not in sys.path:
        sys.path.insert(0, text)

from app.main import app  # noqa: E402
