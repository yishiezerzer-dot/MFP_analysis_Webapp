import os
import shutil
import sys
import tempfile
from pathlib import Path

_MFP_ROOT = Path(__file__).resolve().parents[3]
if str(_MFP_ROOT) not in sys.path:
    sys.path.insert(0, str(_MFP_ROOT))

# Must run before any test module imports `app.*`: data paths are resolved at import time,
# and without this the suite writes fixture sessions into the real lab database.
_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="mfp_pytest_data_"))
os.environ["MFP_DATA_DIR"] = str(_TEST_DATA_DIR)
os.environ["MFP_AUTOMATION_LOG_DB"] = str(_TEST_DATA_DIR / "automation" / "action_log.sqlite3")


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)
