#!/usr/bin/env bash
set -euo pipefail
cd MFP_analysis_app/web/backend
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
