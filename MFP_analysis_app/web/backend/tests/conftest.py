import os
import shutil
import tempfile
from pathlib import Path

# Must run before any test module imports `app.*`: data paths are resolved at import time,
# and without this the suite writes fixture sessions into the real lab database.
_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="mfp_pytest_data_"))
os.environ["MFP_DATA_DIR"] = str(_TEST_DATA_DIR)
os.environ["MFP_AUTOMATION_LOG_DB"] = str(_TEST_DATA_DIR / "automation" / "action_log.sqlite3")


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)
