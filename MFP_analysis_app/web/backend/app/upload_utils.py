import tempfile
from pathlib import Path
from typing import Optional

import httpx
from fastapi import HTTPException, UploadFile

from .blob_store import download_bytes, filename_from_blob_url


async def read_upload_bytes(
    file: Optional[UploadFile],
    blob_url: Optional[str],
    blob_filename: Optional[str],
    *,
    field_name: str = "file",
) -> tuple[bytes, str]:
    if blob_url:
        name = blob_filename or filename_from_blob_url(blob_url)
        try:
            data = await download_bytes(blob_url)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=400, detail=f"Failed to download blob: {exc}") from exc
        return data, name

    if file is None:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} or blob_url is required.",
        )

    name = file.filename or "upload.bin"
    data = await file.read()
    return data, name
