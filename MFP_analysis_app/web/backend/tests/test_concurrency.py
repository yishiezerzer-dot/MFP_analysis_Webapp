"""One user's long analysis must not freeze the server for everyone else."""
import socket
import threading
import time

import httpx
import pytest
import uvicorn

from app.main import app
from test_mzml_fast_index import _generate_synthetic_mzml

SLOW = 1.5


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def base_url():
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            httpx.get(url + "/api/health", timeout=0.5)
            break
        except httpx.HTTPError:
            time.sleep(0.05)
    yield url
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture(scope="module")
def sid(base_url):
    resp = httpx.post(
        base_url + "/api/lcms/sessions",
        files={"file": ("conc.mzML", _generate_synthetic_mzml(num_scans=5), "application/octet-stream")},
        timeout=30,
    )
    return resp.json()["session_id"]


def _slow(*_a, **_k):
    time.sleep(SLOW)
    raise RuntimeError("stubbed slow operation")


def _health_latency_while(base_url, fire):
    worker = threading.Thread(target=fire, daemon=True)
    worker.start()
    time.sleep(0.3)
    t0 = time.perf_counter()
    httpx.get(base_url + "/api/health", timeout=10)
    latency = time.perf_counter() - t0
    worker.join(timeout=10)
    return latency


@pytest.mark.parametrize(
    "target,method,path,kwargs",
    [
        ("app.routers.lcms.extracted_ion_chromatogram", "post", "/api/lcms/sessions/{sid}/eic", {"json": {"mz": 500.0}}),
        ("app.routers.lcms.fetch_spectrum_at_rt", "get", "/api/lcms/sessions/{sid}/spectrum?rt_min=0.1", {}),
        ("app.routers.lcms.summed_spectrum_in_rt_range", "post", "/api/lcms/sessions/{sid}/region-spectrum", {"json": {"rt_min": 0, "rt_max": 1}}),
    ],
)
def test_analysis_does_not_block_other_requests(base_url, sid, monkeypatch, target, method, path, kwargs):
    monkeypatch.setattr(target, _slow)
    url = base_url + path.format(sid=sid)

    def fire():
        try:
            getattr(httpx, method)(url, timeout=10, **kwargs)
        except httpx.HTTPError:
            pass

    assert _health_latency_while(base_url, fire) < 0.5


def test_upload_parsing_does_not_block_other_requests(base_url, monkeypatch):
    from app.services import lcms_service

    monkeypatch.setattr(lcms_service.registry, "add_from_path", _slow)

    def fire():
        try:
            httpx.post(
                base_url + "/api/lcms/sessions",
                files={"file": ("slow.mzML", _generate_synthetic_mzml(num_scans=3), "application/octet-stream")},
                timeout=10,
            )
        except httpx.HTTPError:
            pass

    assert _health_latency_while(base_url, fire) < 0.5
