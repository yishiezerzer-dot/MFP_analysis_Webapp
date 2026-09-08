import hashlib
import tempfile
import uuid
from pathlib import Path
from typing import Optional, Set

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


async def stream_upload_to_file(
    file: Optional[UploadFile],
    blob_url: Optional[str],
    blob_filename: Optional[str],
    dest_dir: Path,
    *,
    field_name: str = "file",
    allowed_extensions: Optional[Set[str]] = None,
    chunk_size: int = 1024 * 1024,
) -> tuple[Path, str]:
    """Stream an incoming upload directly to dest_dir in chunks, computing sha256 on the fly.
    
    This avoids buffering the entire file in RAM, protecting Railway containers from OOM
    when uploading large .mzML files or batch uploads.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()

    if blob_url:
        name = blob_filename or filename_from_blob_url(blob_url)
    elif file is not None:
        name = file.filename or "upload.bin"
    else:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} or blob_url is required.",
        )

    if allowed_extensions is not None:
        lower_name = name.lower()
        if not any(lower_name.endswith(ext.lower()) for ext in allowed_extensions):
            exts_str = ", ".join(sorted(allowed_extensions))
            raise HTTPException(status_code=400, detail=f"Invalid file extension. Expected one of: {exts_str}")

    temp_dest = dest_dir / f".tmp_{uuid.uuid4().hex}"

    try:
        if blob_url:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("GET", blob_url) as resp:
                    resp.raise_for_status()
                    with open(temp_dest, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size):
                            hasher.update(chunk)
                            f.write(chunk)
        else:
            with open(temp_dest, "wb") as f:
                while True:
                    chunk = await file.read(chunk_size)
                    if not chunk:
                        break
                    hasher.update(chunk)
                    f.write(chunk)
    except Exception as exc:
        if temp_dest.exists():
            temp_dest.unlink(missing_ok=True)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Failed writing upload to disk: {exc}") from exc

    safe_name = Path(name).name or "upload"
    stem = Path(safe_name).stem or "upload"
    suffix = "".join(Path(safe_name).suffixes)
    digest = hasher.hexdigest()[:12]
    final_dest = dest_dir / f"{stem}.{digest}{suffix}"

    if temp_dest.exists():
        temp_dest.replace(final_dest)

    return final_dest, name

